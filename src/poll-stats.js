'use strict';

const MIN_BEHAVIOR_SAMPLE = 3;
const MIN_EXTENDED_SAMPLE = 5;
const MIN_PAIR_SAMPLE = 5;
const MIN_BEHAVIOR_PARTICIPATION_RATE = 20;
const STATS_TIMEZONE = 'America/Sao_Paulo';
const DAY_NAMES = Object.freeze([
  ['segunda-feira', 'Seg'], ['terça-feira', 'Ter'], ['quarta-feira', 'Qua'],
  ['quinta-feira', 'Qui'], ['sexta-feira', 'Sex'], ['sábado', 'Sáb'], ['domingo', 'Dom']
]);

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function validTimestamp(value) {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return null;
  const seconds = timestamp > 10_000_000_000 ? Math.floor(timestamp / 1000) : Math.floor(timestamp);
  return Number.isFinite(new Date(seconds * 1000).getTime()) ? seconds : null;
}

function maskWhatsAppId(value) {
  const id = cleanString(value);
  if (!id) return 'Participante não identificado';
  const number = id.split('@')[0];
  return `••••${number.length <= 4 ? number : number.slice(-4)}`;
}

function displayName(name, id) {
  return cleanString(name) || maskWhatsAppId(id);
}

function normalizeWhatsAppId(value) {
  if (typeof value === 'string') return cleanString(value);
  if (typeof value?._serialized === 'string') return cleanString(value._serialized);
  return '';
}

function normalizeCreator(poll) {
  const explicitId = normalizeWhatsAppId(poll?.creatorId)
    || normalizeWhatsAppId(poll?.authorId)
    || normalizeWhatsAppId(poll?.author);
  const contextualId = normalizeWhatsAppId(poll?.participant)
    || normalizeWhatsAppId(poll?.from);
  const candidateId = explicitId || (contextualId.endsWith('@g.us') ? '' : contextualId);
  if (!candidateId || candidateId.endsWith('@g.us')) return { creatorId: null, creatorName: null };
  return {
    creatorId: candidateId,
    creatorName: displayName(
      poll?.creatorName || poll?.authorName || poll?.participantName || poll?.fromName,
      candidateId
    )
  };
}

function normalizePolls(scan) {
  const sourcePolls = Array.isArray(scan?.polls) ? scan.polls : [];
  const seenMessageIds = new Set();

  return sourcePolls.flatMap((poll, pollIndex) => {
    const messageId = cleanString(poll?.messageId);
    if (messageId && seenMessageIds.has(messageId)) return [];
    if (messageId) seenMessageIds.add(messageId);
    const options = [...new Set((Array.isArray(poll?.options) ? poll.options : [])
      .map(cleanString).filter(Boolean))];
    const validOptions = new Set(options);
    const votesByMember = new Map();

    if (poll?.votesAvailable && Array.isArray(poll.votes)) {
      poll.votes.forEach((vote, voteIndex) => {
        const voterId = normalizeWhatsAppId(vote?.voterId);
        if (!voterId) return;
        const candidate = {
          userId: voterId,
          name: displayName(vote?.voterName || vote?.name, voterId),
          selectedOptions: [...new Set((Array.isArray(vote?.selectedOptions)
            ? vote.selectedOptions : []).map(cleanString).filter((name) => validOptions.has(name)))],
          voteTimestamp: validTimestamp(vote?.voteTimestamp ?? vote?.timestamp),
          order: voteIndex
        };
        const previous = votesByMember.get(voterId);
        if (!previous || isLaterVote(candidate, previous)) votesByMember.set(voterId, candidate);
      });
    }

    const participants = [...votesByMember.values()]
      .filter((participant) => participant.selectedOptions.length > 0)
      .map(({ order: _order, ...participant }) => participant);
    const creator = normalizeCreator(poll);
    return [{
      id: messageId || `poll-${pollIndex}`,
      question: cleanString(poll?.question) || 'Enquete sem pergunta disponível',
      timestamp: validTimestamp(poll?.timestamp),
      options,
      votesAvailable: poll?.votesAvailable === true,
      participants,
      // Alias mantido para consumidores e testes anteriores.
      votes: participants.map((participant) => ({
        voterId: participant.userId,
        voterName: participant.name,
        selectedOptions: participant.selectedOptions,
        timestamp: participant.voteTimestamp
      })),
      ...creator
    }];
  });
}

function isLaterVote(candidate, previous) {
  if (candidate.voteTimestamp !== null && previous.voteTimestamp !== null) {
    return candidate.voteTimestamp >= previous.voteTimestamp;
  }
  if (candidate.voteTimestamp !== null && previous.voteTimestamp === null) return true;
  if (candidate.voteTimestamp === null && previous.voteTimestamp !== null) return false;
  return candidate.order >= previous.order;
}

function getPollOutcome(poll) {
  const optionCounts = new Map((poll?.options || []).map((option) => [option, 0]));
  (poll?.participants || poll?.votes || []).forEach((participant) => {
    participant.selectedOptions.forEach((option) => {
      if (optionCounts.has(option)) optionCounts.set(option, optionCounts.get(option) + 1);
    });
  });
  const optionResults = [...optionCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'pt-BR'))
    .map(([name, voteCount]) => ({ name, voteCount }));
  const values = optionResults.map(({ voteCount }) => voteCount);
  const maxVotes = values.length ? Math.max(...values) : null;
  const minVotes = values.length ? Math.min(...values) : null;
  return {
    optionCounts,
    optionResults,
    winners: new Set(maxVotes !== null && maxVotes > 0
      ? optionResults.filter(({ voteCount }) => voteCount === maxVotes).map(({ name }) => name)
      : []),
    lastPlaceOptions: new Set(minVotes !== null
      ? optionResults.filter(({ voteCount }) => voteCount === minVotes).map(({ name }) => name)
      : []),
    maxVotes,
    minVotes
  };
}

function calculatePollStats(scan, options = {}) {
  const minimumSample = positiveInteger(options.minimumSample) || MIN_BEHAVIOR_SAMPLE;
  const minimumExtendedSample = positiveInteger(options.minimumExtendedSample)
    || positiveInteger(options.minimumSample) || MIN_EXTENDED_SAMPLE;
  const minimumPairSample = positiveInteger(options.minimumPairSample)
    || positiveInteger(options.minimumSample) || MIN_PAIR_SAMPLE;
  const minimumBehaviorParticipationRate = validPercentage(options.minimumBehaviorParticipationRate)
    ?? MIN_BEHAVIOR_PARTICIPATION_RATE;
  const polls = normalizePolls(scan);
  const eligiblePolls = polls.filter((poll) => poll.votesAvailable);
  const members = new Map();
  const pollResults = [];
  const firstCounts = new Map();
  const lastCounts = new Map();
  const dayCounts = new Map(DAY_NAMES.map(([name]) => [name, 0]));
  const hourCounts = new Map(Array.from({ length: 24 }, (_, hour) => [hour, 0]));
  let totalParticipations = 0;
  let validTimestampVotes = 0;
  let timedPolls = 0;

  eligiblePolls.forEach((poll) => {
    const outcome = getPollOutcome(poll);
    const validTimedParticipants = poll.participants.filter((participant) => (
      participant.voteTimestamp !== null
      && (poll.timestamp === null || participant.voteTimestamp >= poll.timestamp)
    ));

    if (validTimedParticipants.length) {
      timedPolls += 1;
      const timestamps = validTimedParticipants.map((participant) => participant.voteTimestamp);
      const firstTimestamp = Math.min(...timestamps);
      const lastTimestamp = Math.max(...timestamps);
      validTimedParticipants.forEach((participant) => {
        if (participant.voteTimestamp === firstTimestamp) increment(firstCounts, participant.userId);
        if (participant.voteTimestamp === lastTimestamp) increment(lastCounts, participant.userId);
        const local = localDateParts(participant.voteTimestamp);
        if (local) {
          increment(dayCounts, local.weekday);
          increment(hourCounts, local.hour);
          validTimestampVotes += 1;
        }
      });
    }

    poll.participants.forEach((participant) => {
      totalParticipations += 1;
      const member = members.get(participant.userId) || {
        id: participant.userId,
        name: participant.name,
        pollsParticipated: 0,
        alignedPolls: 0,
        contrarianPolls: 0,
        lastPlacePolls: 0,
        lastPlaceEligiblePolls: 0,
        voteDelays: []
      };
      if (isMaskedName(member.name) && !isMaskedName(participant.name)) member.name = participant.name;
      member.pollsParticipated += 1;
      if (outcome.winners.size > 0 && participant.selectedOptions.some((option) => outcome.winners.has(option))) {
        member.alignedPolls += 1;
      } else if (outcome.winners.size > 0) {
        member.contrarianPolls += 1;
      }
      if (outcome.lastPlaceOptions.size > 0) {
        member.lastPlaceEligiblePolls += 1;
        if (participant.selectedOptions.some((option) => outcome.lastPlaceOptions.has(option))) {
          member.lastPlacePolls += 1;
        }
      }
      if (poll.timestamp !== null && participant.voteTimestamp !== null
        && participant.voteTimestamp >= poll.timestamp) {
        member.voteDelays.push(participant.voteTimestamp - poll.timestamp);
      }
      members.set(participant.userId, member);
    });

    pollResults.push({
      id: poll.id,
      question: poll.question,
      timestamp: poll.timestamp,
      optionCount: poll.options.length,
      participantCount: poll.participants.length,
      optionResults: outcome.optionResults
    });
  });

  const denominator = eligiblePolls.length;
  const ranking = [...members.values()].map((member) => {
    const behaviorPolls = member.alignedPolls + member.contrarianPolls;
    const alignedProbability = behaviorPolls ? member.alignedPolls / behaviorPolls : 0;
    return {
      id: member.id,
      name: member.name,
      pollsParticipated: member.pollsParticipated,
      participationRate: percentage(member.pollsParticipated, denominator),
      alignedPolls: member.alignedPolls,
      alignedRate: percentage(member.alignedPolls, behaviorPolls),
      contrarianPolls: member.contrarianPolls,
      contrarianRate: percentage(member.contrarianPolls, behaviorPolls),
      behaviorPolls,
      unpredictability: binaryEntropy(alignedProbability),
      lastPlacePolls: member.lastPlacePolls,
      lastPlaceEligiblePolls: member.lastPlaceEligiblePolls,
      lastPlaceRate: percentage(member.lastPlacePolls, member.lastPlaceEligiblePolls),
      validTimingSamples: member.voteDelays.length,
      averageVoteDelaySeconds: member.voteDelays.length
        ? member.voteDelays.reduce((sum, value) => sum + value, 0) / member.voteDelays.length
        : null
    };
  }).sort((a, b) => b.pollsParticipated - a.pollsParticipated
    || b.participationRate - a.participationRate || compareNames(a, b));

  const behaviorParticipationEligible = new Set(getParticipationEligibleMembers(
    ranking,
    minimumBehaviorParticipationRate,
    { inclusive: true }
  ).map((member) => member.id));
  const behavioral = ranking.filter((member) => (
    member.behaviorPolls >= minimumSample && behaviorParticipationEligible.has(member.id)
  ));
  const extendedBehavioral = ranking.filter((member) => (
    member.behaviorPolls >= minimumExtendedSample && behaviorParticipationEligible.has(member.id)
  ));
  const unluckyEligible = ranking.filter((member) => (
    member.lastPlaceEligiblePolls >= minimumExtendedSample && behaviorParticipationEligible.has(member.id)
  ));
  const timed = ranking.filter((member) => member.validTimingSamples >= minimumSample);
  const highestParticipationPoll = [...pollResults]
    .sort((a, b) => b.participantCount - a.participantCount
      || (b.timestamp || 0) - (a.timestamp || 0))[0] || null;
  const closestPoll = pollResults.filter((poll) => (
    poll.participantCount >= minimumSample
    && poll.optionResults.filter((option) => option.voteCount > 0).length >= 2
  )).map((poll) => ({
    ...poll,
    leaders: poll.optionResults.slice(0, 2),
    difference: poll.optionResults[0].voteCount - poll.optionResults[1].voteCount
  })).sort((a, b) => a.difference - b.difference
    || (b.timestamp || 0) - (a.timestamp || 0))[0] || null;

  const creatorStats = calculateCreatorStats(polls);
  const firstVoter = timingLeader(firstCounts, members, timedPolls);
  const lastVoter = timingLeader(lastCounts, members, timedPolls);
  const pairAffinity = calculatePairAffinity(eligiblePolls, ranking, {
    minimumPairSample,
    minimumParticipationRate: minimumBehaviorParticipationRate
  });
  const dayDistribution = DAY_NAMES.map(([name, shortLabel]) => ({
    name, shortLabel, count: dayCounts.get(name), percentage: percentage(dayCounts.get(name), validTimestampVotes)
  }));
  const mostActiveDay = validTimestampVotes
    ? [...dayDistribution].sort((a, b) => b.count - a.count
      || DAY_NAMES.findIndex(([name]) => name === a.name)
        - DAY_NAMES.findIndex(([name]) => name === b.name))[0]
    : null;
  const activeHours = [...hourCounts].map(([hour, count]) => ({
    hour,
    label: `${String(hour).padStart(2, '0')}h`,
    rangeLabel: `${String(hour).padStart(2, '0')}h–${String((hour + 1) % 24).padStart(2, '0')}h`,
    count,
    percentage: percentage(count, validTimestampVotes)
  }));
  const topHours = [...activeHours].filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count || a.hour - b.hour).slice(0, 4);

  return {
    summary: {
      group: scan?.group && typeof scan.group === 'object'
        ? { id: cleanString(scan.group.id), name: cleanString(scan.group.name) || 'Grupo sem nome' }
        : null,
      pollsFound: Number.isInteger(scan?.pollsFound) ? scan.pollsFound : polls.length,
      eligiblePolls: denominator,
      totalParticipations,
      identifiedParticipants: ranking.length,
      validTimestampVotes,
      timedPolls,
      identifiedCreators: creatorStats.creatorRanking.length,
      pollsWithIdentifiedCreator: creatorStats.pollsWithIdentifiedCreator
    },
    mostActive: ranking[0] || null,
    leastActive: [...ranking].sort((a, b) => a.pollsParticipated - b.pollsParticipated
      || a.participationRate - b.participationRate || compareNames(a, b))[0] || null,
    participationRanking: ranking,
    fastestVoter: [...timed].sort((a, b) => a.averageVoteDelaySeconds - b.averageVoteDelaySeconds
      || b.validTimingSamples - a.validTimingSamples || compareNames(a, b))[0] || null,
    mostAligned: [...behavioral].sort((a, b) => b.alignedRate - a.alignedRate
      || b.behaviorPolls - a.behaviorPolls || compareNames(a, b))[0] || null,
    mostContrarian: [...behavioral].sort((a, b) => b.contrarianRate - a.contrarianRate
      || b.behaviorPolls - a.behaviorPolls || compareNames(a, b))[0] || null,
    mostUnpredictable: [...extendedBehavioral].sort((a, b) => b.unpredictability - a.unpredictability
      || b.behaviorPolls - a.behaviorPolls || compareNames(a, b))[0] || null,
    unluckiestMember: [...unluckyEligible].sort((a, b) => b.lastPlaceRate - a.lastPlaceRate
      || b.lastPlaceEligiblePolls - a.lastPlaceEligiblePolls || compareNames(a, b))[0] || null,
    firstVoter,
    lastVoter,
    ...pairAffinity,
    mostActiveDay: mostActiveDay ? { ...mostActiveDay, distribution: dayDistribution } : null,
    primeTime: topHours.length ? { ...topHours[0], topHours } : null,
    ...creatorStats,
    highestParticipationPoll,
    closestPoll,
    minimumBehaviorSample: minimumSample,
    minimumExtendedSample,
    minimumPairSample,
    minimumBehaviorParticipationRate,
    statsTimezone: STATS_TIMEZONE
  };
}

function calculateCreatorStats(polls) {
  const creators = new Map();
  let pollsWithIdentifiedCreator = 0;
  polls.forEach((poll) => {
    if (!poll.creatorId) return;
    pollsWithIdentifiedCreator += 1;
    const creator = creators.get(poll.creatorId) || {
      id: poll.creatorId, name: poll.creatorName, pollsCreated: 0
    };
    if (isMaskedName(creator.name) && !isMaskedName(poll.creatorName)) creator.name = poll.creatorName;
    creator.pollsCreated += 1;
    creators.set(poll.creatorId, creator);
  });
  const creatorRanking = [...creators.values()].map((creator) => ({
    ...creator,
    percentage: percentage(creator.pollsCreated, pollsWithIdentifiedCreator)
  })).sort((a, b) => b.pollsCreated - a.pollsCreated || compareNames(a, b));
  const leastRanking = [...creatorRanking]
    .sort((a, b) => a.pollsCreated - b.pollsCreated || compareNames(a, b));
  return {
    topPollCreator: creatorRanking[0] || null,
    leastPollCreator: creatorRanking.length > 1 ? leastRanking[0] : null,
    onlyOneIdentifiedCreator: creatorRanking.length === 1,
    creatorRanking,
    pollsWithIdentifiedCreator
  };
}

function timingLeader(counts, members, eligiblePollCount) {
  if (!counts.size || !eligiblePollCount) return null;
  const ranking = [...counts].map(([id, count]) => ({
    id,
    name: members.get(id)?.name || maskWhatsAppId(id),
    count,
    percentage: percentage(count, eligiblePollCount)
  })).sort((a, b) => b.count - a.count || compareNames(a, b));
  const leaders = ranking.filter((candidate) => candidate.count === ranking[0].count);
  return { ...ranking[0], leaders, eligiblePolls: eligiblePollCount, ranking };
}

function getParticipationEligibleMembers(members, minimumParticipationRate, { inclusive = false } = {}) {
  return members.filter((member) => inclusive
    ? member.participationRate >= minimumParticipationRate
    : member.participationRate > minimumParticipationRate);
}

function jaccardSimilarity(leftOptions, rightOptions) {
  const left = leftOptions instanceof Set ? leftOptions : new Set(leftOptions || []);
  const right = rightOptions instanceof Set ? rightOptions : new Set(rightOptions || []);
  const union = new Set([...left, ...right]);
  if (!union.size) return 0;
  let intersectionSize = 0;
  left.forEach((option) => {
    if (right.has(option)) intersectionSize += 1;
  });
  return intersectionSize / union.size;
}

function calculatePairAffinity(polls, participationRanking, options = {}) {
  const minimumPairSample = positiveInteger(options.minimumPairSample) || MIN_PAIR_SAMPLE;
  const minimumParticipationRate = validPercentage(options.minimumParticipationRate)
    ?? MIN_BEHAVIOR_PARTICIPATION_RATE;
  const eligibleMembers = getParticipationEligibleMembers(
    participationRanking,
    minimumParticipationRate
  );
  const eligibleById = new Map(eligibleMembers.map((member) => [member.id, member]));
  const pairCounts = new Map();

  polls.forEach((poll) => {
    const participants = poll.participants.filter((participant) => eligibleById.has(participant.userId));
    for (let left = 0; left < participants.length; left += 1) {
      for (let right = left + 1; right < participants.length; right += 1) {
        const orderedIds = [participants[left].userId, participants[right].userId].sort();
        const key = `${orderedIds[0]}\u0000${orderedIds[1]}`;
        const pair = pairCounts.get(key) || {
          memberA: memberIdentity(eligibleById.get(orderedIds[0])),
          memberB: memberIdentity(eligibleById.get(orderedIds[1])),
          totalSimilarity: 0,
          pollsTogether: 0
        };
        pair.totalSimilarity += jaccardSimilarity(
          participants[left].selectedOptions,
          participants[right].selectedOptions
        );
        pair.pollsTogether += 1;
        pairCounts.set(key, pair);
      }
    }
  });

  const pairs = [...pairCounts.values()]
    .filter((pair) => pair.pollsTogether >= minimumPairSample)
    .map((pair) => {
      const averageSimilarity = pair.totalSimilarity / pair.pollsTogether;
      const oppositionScore = 1 - averageSimilarity;
      return {
        memberA: pair.memberA,
        memberB: pair.memberB,
        members: [pair.memberA, pair.memberB],
        pollsTogether: pair.pollsTogether,
        averageSimilarity,
        oppositionScore,
        similarityRate: averageSimilarity * 100,
        oppositionRate: oppositionScore * 100
      };
    });
  const similarityRanking = [...pairs].sort((a, b) => (
    b.averageSimilarity - a.averageSimilarity
    || b.pollsTogether - a.pollsTogether
    || comparePairNames(a, b)
  ));
  const oppositionRanking = [...pairs].sort((a, b) => (
    b.oppositionScore - a.oppositionScore
    || b.pollsTogether - a.pollsTogether
    || comparePairNames(a, b)
  ));

  return {
    eligibleMembers,
    pairs,
    similarityRanking,
    oppositionRanking,
    mostSimilarPair: similarityRanking[0] || null,
    mostOppositePair: oppositionRanking[0] || null
  };
}

function memberIdentity(member) {
  return { id: member.id, name: member.name };
}

function localDateParts(timestamp) {
  try {
    const parts = new Intl.DateTimeFormat('pt-BR', {
      timeZone: STATS_TIMEZONE,
      weekday: 'long',
      hour: '2-digit',
      hourCycle: 'h23'
    }).formatToParts(new Date(timestamp * 1000));
    const weekday = parts.find((part) => part.type === 'weekday')?.value.toLocaleLowerCase('pt-BR');
    const hour = Number(parts.find((part) => part.type === 'hour')?.value);
    return DAY_NAMES.some(([name]) => name === weekday) && Number.isInteger(hour) && hour >= 0 && hour <= 23
      ? { weekday, hour }
      : null;
  } catch (_error) {
    return null;
  }
}

function binaryEntropy(probability) {
  if (probability <= 0 || probability >= 1) return 0;
  return -(probability * Math.log2(probability)
    + (1 - probability) * Math.log2(1 - probability));
}

function increment(map, key) {
  map.set(key, (map.get(key) || 0) + 1);
}

function positiveInteger(value) {
  return Number.isInteger(value) && value > 0 ? value : null;
}

function validPercentage(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100
    ? value
    : null;
}

function percentage(value, total) {
  return total > 0 ? (value / total) * 100 : 0;
}

function isMaskedName(name) {
  return !name || name.startsWith('••••');
}

function compareNames(a, b) {
  return a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }) || a.id.localeCompare(b.id);
}

function comparePairNames(a, b) {
  const label = (pair) => [...pair.members].sort(compareNames)
    .map((member) => `${member.name}\u0000${member.id}`).join('\u0000');
  return label(a).localeCompare(label(b), 'pt-BR', { sensitivity: 'base' });
}

module.exports = {
  calculatePollStats,
  calculatePairAffinity,
  getParticipationEligibleMembers,
  jaccardSimilarity,
  normalizePolls,
  getPollOutcome,
  MIN_BEHAVIOR_SAMPLE,
  MIN_EXTENDED_SAMPLE,
  MIN_PAIR_SAMPLE,
  MIN_BEHAVIOR_PARTICIPATION_RATE,
  STATS_TIMEZONE
};
