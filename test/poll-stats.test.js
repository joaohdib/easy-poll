'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { calculatePollStats, normalizePolls } = require('../src/poll-stats');

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
  assert.deepEqual(stats.summary, {
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
