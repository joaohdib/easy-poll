'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  calculatePollStats: calculateNormalizedPollStats,
  jaccardSimilarity
} = require('../src/services/stats.service');
const {
  normalizePollScan,
  normalizePolls
} = require('../src/services/poll.service');

function calculatePollStats(input, options) {
  return calculateNormalizedPollStats(normalizePollScan(input), options);
}

const voters = {
  joao: ['111@c.us', 'João'],
  maria: ['222@c.us', 'Maria'],
  pedro: ['333@c.us', 'Pedro'],
  outroJoao: ['444@c.us', 'João']
};

function vote(member, selectedOptions, timestamp) {
  return { voterId: member[0], voterName: member[1], selectedOptions, timestamp };
}

function poll(question, timestamp, options, votes, extra = {}) {
  return { question, timestamp, options, votes, votesAvailable: true, ...extra };
}

function scan(polls) {
  return {
    group: { id: 'group@g.us', name: 'Grupo dos Amigos' },
    pollsFound: polls.length,
    pollsWithVotesAvailable: polls.filter((item) => item.votesAvailable).length,
    polls
  };
}

test('calculates participation once per poll and keeps duplicate names as separate IDs', () => {
  const data = scan([
    poll('A', 100, ['X', 'Y'], [
      vote(voters.joao, ['X', 'Y'], 110),
      vote(voters.maria, ['X'], 120),
      vote(voters.outroJoao, ['Y'], 130)
    ]),
    poll('B', 200, ['A', 'B'], [vote(voters.joao, ['A'], 220), vote(voters.maria, ['B'], 240)]),
    poll('C', 300, ['Z', 'W'], [vote(voters.joao, ['Z'], 330), vote(voters.maria, ['Z'], 360)]),
    { question: 'Sem votos recuperados', votesAvailable: false, options: ['A', 'B'], votes: [] }
  ]);

  const stats = calculatePollStats(data);
  assert.deepEqual({
    group: stats.summary.group,
    pollsFound: stats.summary.pollsFound,
    eligiblePolls: stats.summary.eligiblePolls,
    totalParticipations: stats.summary.totalParticipations,
    identifiedParticipants: stats.summary.identifiedParticipants
  }, {
    group: { id: 'group@g.us', name: 'Grupo dos Amigos' },
    pollsFound: 4,
    eligiblePolls: 3,
    totalParticipations: 7,
    identifiedParticipants: 3
  });
  assert.equal(stats.mostActive.id, voters.joao[0]);
  assert.equal(stats.mostActive.pollsParticipated, 3);
  assert.equal(stats.mostActive.participationRate, 100);
  assert.equal(stats.leastActive.id, voters.outroJoao[0]);
  assert.equal(stats.participationRanking.filter((member) => member.name === 'João').length, 2);
});

test('handles ties, multiple answers, alignment and contrarian rates', () => {
  const data = scan([
    poll('Empate', 100, ['A', 'B', 'C'], [
      vote(voters.joao, ['A', 'C'], 110), vote(voters.maria, ['B'], 120), vote(voters.pedro, ['A', 'B'], 130)
    ]),
    poll('Vitória A', 200, ['A', 'B'], [
      vote(voters.joao, ['A'], 210), vote(voters.maria, ['B'], 220), vote(voters.pedro, ['A'], 230)
    ]),
    poll('Vitória B', 300, ['A', 'B'], [
      vote(voters.joao, ['B'], 310), vote(voters.maria, ['A'], 320), vote(voters.pedro, ['B'], 330)
    ])
  ]);
  const stats = calculatePollStats(data);
  const joao = stats.participationRanking.find((member) => member.id === voters.joao[0]);
  const maria = stats.participationRanking.find((member) => member.id === voters.maria[0]);

  assert.equal(joao.alignedPolls, 3);
  assert.equal(joao.contrarianPolls, 0);
  assert.equal(stats.mostAligned.id, voters.joao[0]);
  assert.equal(maria.alignedPolls, 1);
  assert.equal(maria.contrarianPolls, 2);
  assert.equal(stats.mostContrarian.id, voters.maria[0]);
  assert.equal(stats.closestPoll.question, 'Empate');
  assert.equal(stats.closestPoll.difference, 0);
});

test('requires three valid timing samples and ignores invalid timestamps', () => {
  const data = scan([
    poll('A', 100, ['X', 'Y'], [vote(voters.joao, ['X'], 105), vote(voters.maria, ['Y'], 101)]),
    poll('B', 200, ['X', 'Y'], [vote(voters.joao, ['X'], 210), vote(voters.maria, ['Y'], 199)]),
    poll('C', 300, ['X', 'Y'], [vote(voters.joao, ['X'], 315), vote(voters.maria, ['Y'], null)])
  ]);
  const stats = calculatePollStats(data);
  assert.equal(stats.fastestVoter.id, voters.joao[0]);
  assert.equal(stats.fastestVoter.validTimingSamples, 3);
  assert.equal(stats.fastestVoter.averageVoteDelaySeconds, 10);
});

test('uses the latest duplicate voter state and ignores empty final selections', () => {
  const data = scan([
    poll('Mudança', 100, ['A', 'B'], [
      vote(voters.joao, ['A'], 110), vote(voters.joao, [], 120), vote(voters.maria, ['B'], 115)
    ])
  ]);
  const normalized = normalizePolls(data);
  assert.equal(normalized[0].votes.length, 1);
  assert.equal(normalized[0].votes[0].voterId, voters.maria[0]);
});

test('does not produce behavioral winners below the minimum sample', () => {
  const stats = calculatePollStats(scan([
    poll('Única', 100, ['A', 'B'], [vote(voters.pedro, ['A'], 101)])
  ]));
  assert.equal(stats.fastestVoter, null);
  assert.equal(stats.mostAligned, null);
  assert.equal(stats.mostContrarian, null);
  assert.equal(stats.closestPoll, null);
});

test('counts a recovered empty poll as eligible without inventing absences', () => {
  const data = scan([
    poll('Sem participantes', null, ['A', 'B'], []),
    { question: 'Indisponível', votesAvailable: false, options: ['A', 'B'], votes: [] }
  ]);
  const stats = calculatePollStats(data);
  assert.equal(stats.summary.pollsFound, 2);
  assert.equal(stats.summary.eligiblePolls, 1);
  assert.equal(stats.summary.totalParticipations, 0);
  assert.equal(stats.summary.identifiedParticipants, 0);
  assert.equal(stats.mostActive, null);
});

test('finds first and last voters and credits exact timestamp ties', () => {
  const data = scan([
    poll('Ordem', 100, ['A', 'B'], [
      vote(voters.joao, ['A'], 101),
      vote(voters.maria, ['B'], 103),
      vote(voters.pedro, ['A'], 110)
    ]),
    poll('Empate', 200, ['A', 'B'], [
      vote(voters.joao, ['A'], 201),
      vote(voters.maria, ['B'], 201),
      vote(voters.pedro, ['A'], 210)
    ])
  ]);
  const stats = calculatePollStats(data);

  assert.equal(stats.firstVoter.id, voters.joao[0]);
  assert.equal(stats.firstVoter.count, 2);
  assert.equal(stats.firstVoter.eligiblePolls, 2);
  assert.deepEqual(
    stats.firstVoter.ranking.filter((member) => member.count === 1).map((member) => member.id),
    [voters.maria[0]]
  );
  assert.equal(stats.lastVoter.id, voters.pedro[0]);
  assert.equal(stats.lastVoter.count, 2);
});

test('ignores timestamps before poll creation in first, last and activity stats', () => {
  const stats = calculatePollStats(scan([
    poll('Inválida', 100, ['A', 'B'], [
      vote(voters.joao, ['A'], 99), vote(voters.maria, ['B'], null)
    ])
  ]));
  assert.equal(stats.firstVoter, null);
  assert.equal(stats.lastVoter, null);
  assert.equal(stats.mostActiveDay, null);
  assert.equal(stats.primeTime, null);
  assert.equal(stats.summary.validTimestampVotes, 0);
});

test('uses average Jaccard similarity as the single source for pair opposition', () => {
  const data = scan([
    poll('1', 100, ['A', 'B'], [vote(voters.joao, ['A'], 101), vote(voters.pedro, ['B'], 102)]),
    poll('2', 200, ['X', 'Y'], [vote(voters.joao, ['X'], 201), vote(voters.pedro, ['Y'], 202)]),
    poll('3', 300, ['M', 'N'], [vote(voters.joao, ['M', 'N'], 301), vote(voters.pedro, ['M'], 302)])
  ]);
  const stats = calculatePollStats(data, { minimumPairSample: 3 });
  assert.deepEqual(stats.mostOppositePair.members.map((member) => member.id), [voters.joao[0], voters.pedro[0]]);
  assert.equal(stats.mostOppositePair.pollsTogether, 3);
  assert.ok(Math.abs(stats.mostOppositePair.averageSimilarity - (1 / 6)) < Number.EPSILON);
  assert.ok(Math.abs(stats.mostOppositePair.oppositionScore - (5 / 6)) < Number.EPSILON);
  assert.equal(stats.mostOppositePair, stats.oppositionRanking[0]);
  assert.equal(stats.mostSimilarPair, stats.similarityRanking[0]);
});

test('calculates Jaccard similarity for equal, disjoint and partially matching choices', () => {
  assert.equal(jaccardSimilarity(['A'], ['A']), 1);
  assert.equal(jaccardSimilarity(['A'], ['B']), 0);
  assert.equal(jaccardSimilarity(['A', 'B'], ['B', 'C']), 1 / 3);
  assert.equal(jaccardSimilarity(['A'], ['A', 'B']), 1 / 2);
});

test('only ranks pair members with participation strictly above 20%', () => {
  const members = {
    joao: voters.joao,
    maria: voters.maria,
    lucas: ['555@c.us', 'Lucas'],
    pedro: voters.pedro,
    gabriel: ['666@c.us', 'Gabriel']
  };
  const participationCounts = { joao: 80, maria: 42, lucas: 21, pedro: 20, gabriel: 7 };
  const polls = Array.from({ length: 100 }, (_, index) => {
    const votes = Object.entries(participationCounts).flatMap(([key, count], voteIndex) => (
      index < count ? [vote(members[key], ['A'], 101 + index * 10 + voteIndex)] : []
    ));
    return poll(`Participação ${index}`, 100 + index * 10, ['A', 'B'], votes);
  });
  const stats = calculatePollStats(scan(polls));

  assert.deepEqual(
    stats.eligibleMembers.map((member) => member.id).sort(),
    [members.joao[0], members.maria[0], members.lucas[0]].sort()
  );
  assert.equal(stats.participationRanking.find((member) => member.id === members.pedro[0]).participationRate, 20);
  assert.equal(stats.participationRanking.find((member) => member.id === members.lucas[0]).participationRate, 21);
  assert.ok(stats.similarityRanking.length > 0);
  assert.ok(stats.similarityRanking.every((pair) => (
    pair.members.every((member) => member.id !== members.pedro[0] && member.id !== members.gabriel[0])
  )));
});

test('requires at least five polls in common even for individually eligible members', () => {
  const polls = Array.from({ length: 10 }, (_, index) => poll(
    `Amostra ${index}`,
    100 + index * 10,
    ['A', 'B'],
    index < 4
      ? [vote(voters.joao, ['A'], 101 + index * 10), vote(voters.maria, ['A'], 102 + index * 10)]
      : []
  ));
  const stats = calculatePollStats(scan(polls));

  assert.equal(stats.participationRanking.find((member) => member.id === voters.joao[0]).participationRate, 40);
  assert.equal(stats.similarityRanking.length, 0);
  assert.equal(stats.oppositionRanking.length, 0);
  assert.equal(stats.mostSimilarPair, null);
  assert.equal(stats.mostOppositePair, null);
});

test('breaks pair ranking ties by common polls and then alphabetical names', () => {
  const ana = ['900@c.us', 'Ana'];
  const bia = ['700@c.us', 'Bia'];
  const caio = ['800@c.us', 'Caio'];
  const polls = Array.from({ length: 10 }, (_, index) => poll(
    `Desempate ${index}`,
    100 + index * 10,
    ['A', 'B'],
    index < 5
      ? [vote(ana, ['A']), vote(bia, ['A']), vote(caio, ['A'])]
      : index === 5 ? [vote(ana, ['A']), vote(bia, ['A'])] : []
  ));
  const stats = calculatePollStats(scan(polls));
  const labels = (ranking) => ranking.map((pair) => pair.members
    .map((member) => member.name).sort((left, right) => left.localeCompare(right, 'pt-BR')).join(' + '));

  assert.deepEqual(labels(stats.similarityRanking), ['Ana + Bia', 'Ana + Caio', 'Bia + Caio']);
  assert.deepEqual(labels(stats.oppositionRanking), ['Ana + Bia', 'Ana + Caio', 'Bia + Caio']);
  assert.deepEqual(stats.similarityRanking.map((pair) => pair.pollsTogether), [6, 5, 5]);
});

test('excludes opposite pairs whose members participated in less than 20% of polls', () => {
  const davi = ['999@c.us', 'Davi'];
  const polls = Array.from({ length: 30 }, (_, index) => poll(
    `Par ${index}`,
    100 + index * 10,
    ['A', 'B'],
    index < 5
      ? [vote(voters.joao, ['A'], 101 + index * 10), vote(davi, [index < 4 ? 'B' : 'A'], 102 + index * 10)]
      : []
  ));
  const stats = calculatePollStats(scan(polls));

  assert.ok(Math.abs(
    stats.participationRanking.find((member) => member.id === davi[0]).participationRate - (100 / 6)
  ) < Number.EPSILON * 100);
  assert.equal(stats.mostOppositePair, null);
});

test('finds the unluckiest member at most once per poll, including zero-vote options', () => {
  const polls = Array.from({ length: 5 }, (_, index) => poll(`Azar ${index}`, 100 + index * 10, ['A', 'B', 'C'], [
    vote(voters.joao, ['A', 'C'], 101 + index * 10),
    vote(voters.maria, ['A'], 102 + index * 10),
    vote(voters.pedro, ['B'], 103 + index * 10)
  ]));
  const stats = calculatePollStats(scan(polls));
  assert.equal(stats.unluckiestMember.id, voters.joao[0]);
  assert.equal(stats.unluckiestMember.lastPlacePolls, 5);
  assert.equal(stats.unluckiestMember.lastPlaceEligiblePolls, 5);
  assert.equal(stats.unluckiestMember.lastPlaceRate, 100);
});

test('ranks balanced aligned/contrarian behavior as more unpredictable', () => {
  const anchors = [
    ['500@c.us', 'Âncora 1'], ['501@c.us', 'Âncora 2'], ['502@c.us', 'Âncora 3']
  ];
  const polls = Array.from({ length: 10 }, (_, index) => poll(`Comportamento ${index}`, 100 + index * 10, ['X', 'Y'], [
    ...anchors.map((anchor, anchorIndex) => vote(anchor, ['X'], 101 + index * 10 + anchorIndex)),
    vote(voters.joao, [index < 5 ? 'X' : 'Y'], 105 + index * 10),
    vote(voters.maria, [index < 9 ? 'X' : 'Y'], 106 + index * 10)
  ]));
  const stats = calculatePollStats(scan(polls));
  assert.equal(stats.mostUnpredictable.id, voters.joao[0]);
  assert.equal(stats.mostUnpredictable.alignedPolls, 5);
  assert.equal(stats.mostUnpredictable.contrarianPolls, 5);
  assert.equal(stats.mostUnpredictable.unpredictability, 1);
});

test('excludes behavioral candidates who participated in less than 20% of eligible polls', () => {
  const lowParticipation = ['777@c.us', 'Bernardo'];
  const anchors = [['888@c.us', 'Âncora 1'], ['889@c.us', 'Âncora 2']];
  const polls = Array.from({ length: 20 }, (_, index) => {
    const votes = [];
    if (index < 3) {
      votes.push(
        ...anchors.map((anchor, anchorIndex) => vote(anchor, ['A'], 101 + index * 10 + anchorIndex)),
        vote(lowParticipation, ['B'], 105 + index * 10)
      );
    } else if (index < 8) {
      votes.push(
        ...anchors.map((anchor, anchorIndex) => vote(anchor, ['A'], 101 + index * 10 + anchorIndex)),
        vote(voters.maria, [index < 5 ? 'B' : 'A'], 105 + index * 10)
      );
    }
    return poll(`Corte ${index}`, 100 + index * 10, ['A', 'B'], votes);
  });
  const stats = calculatePollStats(scan(polls));

  const bernardo = stats.participationRanking.find((member) => member.id === lowParticipation[0]);
  assert.equal(bernardo.participationRate, 15);
  assert.equal(bernardo.contrarianRate, 100);
  assert.equal(stats.minimumBehaviorParticipationRate, 20);
  assert.equal(stats.mostContrarian.id, voters.maria[0]);
  assert.equal(stats.mostUnpredictable.id, voters.maria[0]);
  assert.notEqual(stats.unluckiestMember?.id, lowParticipation[0]);
});

test('ranks identified creators, deduplicates message IDs and excludes zero creators', () => {
  const authoredPolls = [];
  const addAuthored = (member, count) => {
    for (let index = 0; index < count; index += 1) {
      authoredPolls.push(poll(`De ${member[1]} ${index}`, 100 + authoredPolls.length, ['A', 'B'], [], {
        messageId: `${member[0]}-${index}`,
        creatorId: member[0],
        creatorName: member[1]
      }));
    }
  };
  addAuthored(voters.joao, 5);
  addAuthored(voters.maria, 3);
  addAuthored(voters.pedro, 1);
  authoredPolls.push({ ...authoredPolls[0] });
  const stats = calculatePollStats(scan(authoredPolls));

  assert.equal(stats.topPollCreator.id, voters.joao[0]);
  assert.equal(stats.topPollCreator.pollsCreated, 5);
  assert.equal(stats.leastPollCreator.id, voters.pedro[0]);
  assert.equal(stats.leastPollCreator.pollsCreated, 1);
  assert.equal(stats.creatorRanking.length, 3);
  assert.equal(stats.summary.pollsWithIdentifiedCreator, 9);
});

test('derives weekday and prime hour in America/Sao_Paulo', () => {
  // 00:30 UTC de sexta-feira ainda é 21:30 de quinta-feira em São Paulo.
  const timestamp = Date.parse('2024-01-05T00:30:00Z') / 1000;
  const stats = calculatePollStats(scan([
    poll('Fuso', timestamp - 60, ['A', 'B'], [
      vote(voters.joao, ['A'], timestamp),
      vote(voters.maria, ['B'], timestamp + 60)
    ])
  ]));
  assert.equal(stats.statsTimezone, 'America/Sao_Paulo');
  assert.equal(stats.mostActiveDay.name, 'quinta-feira');
  assert.equal(stats.mostActiveDay.count, 2);
  assert.equal(stats.primeTime.hour, 21);
  assert.equal(stats.primeTime.count, 2);
});

test('does not call a sole identified creator both most and least prolific', () => {
  const stats = calculatePollStats(scan([
    poll('Única', 100, ['A', 'B'], [], {
      messageId: 'one', creatorId: voters.joao[0], creatorName: voters.joao[1]
    })
  ]));
  assert.equal(stats.topPollCreator.id, voters.joao[0]);
  assert.equal(stats.leastPollCreator, null);
  assert.equal(stats.onlyOneIdentifiedCreator, true);
});
