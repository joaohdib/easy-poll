'use strict';

const MIN_BEHAVIOR_SAMPLE = 3;

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function validTimestamp(value) {
  const timestamp = Number(value);
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : null;
}

function memberName(vote) {
  return cleanString(vote?.voterName) || maskWhatsAppId(vote?.voterId);
}

function maskWhatsAppId(value) {
  const id = cleanString(value);
  if (!id) return 'Participante não identificado';
  const number = id.split('@')[0];
  if (number.length <= 4) return `••••${number}`;
  return `••••${number.slice(-4)}`;
}

function normalizePolls(scan) {
  const sourcePolls = Array.isArray(scan?.polls) ? scan.polls : [];
  return sourcePolls.map((poll, pollIndex) => {
    const options = [...new Set((Array.isArray(poll?.options) ? poll.options : [])
      .map(cleanString).filter(Boolean))];
    const validOptions = new Set(options);
    const votesByMember = new Map();

    if (poll?.votesAvailable && Array.isArray(poll.votes)) {
      poll.votes.forEach((vote, voteIndex) => {
        const voterId = cleanString(vote?.voterId);
        if (!voterId) return;
        const timestamp = validTimestamp(vote?.timestamp);
        const selectedOptions = [...new Set((Array.isArray(vote?.selectedOptions)
          ? vote.selectedOptions : []).map(cleanString).filter((name) => validOptions.has(name)))];
        const candidate = {
          voterId,
          voterName: memberName(vote),
          selectedOptions,
          timestamp,
          order: voteIndex
        };
        const previous = votesByMember.get(voterId);
        if (!previous || isLaterVote(candidate, previous)) votesByMember.set(voterId, candidate);
      });
    }

    const votes = [...votesByMember.values()].filter((vote) => vote.selectedOptions.length > 0);
    return {
      id: cleanString(poll?.messageId) || `poll-${pollIndex}`,
      question: cleanString(poll?.question) || 'Enquete sem pergunta disponível',
      timestamp: validTimestamp(poll?.timestamp),
      options,
      votesAvailable: poll?.votesAvailable === true,
      votes
    };
  });
}

function isLaterVote(candidate, previous) {
  if (candidate.timestamp !== null && previous.timestamp !== null) {
    return candidate.timestamp >= previous.timestamp;
  }
  if (candidate.timestamp !== null && previous.timestamp === null) return true;
  if (candidate.timestamp === null && previous.timestamp !== null) return false;
  return candidate.order >= previous.order;
}

function calculatePollStats(scan, options = {}) {
  const minimumSample = Number.isInteger(options.minimumSample) && options.minimumSample > 0
    ? options.minimumSample : MIN_BEHAVIOR_SAMPLE;
  const polls = normalizePolls(scan);
  const eligiblePolls = polls.filter((poll) => poll.votesAvailable);
  const members = new Map();
  const pollResults = [];
  let totalParticipations = 0;

  eligiblePolls.forEach((poll) => {
    const counts = new Map(poll.options.map((option) => [option, 0]));
    poll.votes.forEach((vote) => vote.selectedOptions.forEach((option) => {
      counts.set(option, (counts.get(option) || 0) + 1);
    }));
    const sortedOptions = [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'pt-BR'));
    const highestCount = sortedOptions[0]?.[1] || 0;
    const winners = new Set(highestCount > 0
      ? sortedOptions.filter(([, count]) => count === highestCount).map(([name]) => name)
      : []);

    poll.votes.forEach((vote) => {
      totalParticipations += 1;
      const member = members.get(vote.voterId) || {
        id: vote.voterId,
        name: vote.voterName,
        pollsParticipated: 0,
        alignedPolls: 0,
        contrarianPolls: 0,
        voteDelays: []
      };
      if ((!member.name || member.name.startsWith('••••')) && vote.voterName) member.name = vote.voterName;
      member.pollsParticipated += 1;
      if (winners.size > 0 && vote.selectedOptions.some((option) => winners.has(option))) {
        member.alignedPolls += 1;
      } else if (winners.size > 0) {
        member.contrarianPolls += 1;
      }
      if (poll.timestamp !== null && vote.timestamp !== null && vote.timestamp >= poll.timestamp) {
        member.voteDelays.push(vote.timestamp - poll.timestamp);
      }
      members.set(vote.voterId, member);
    });

    pollResults.push({
      id: poll.id,
      question: poll.question,
      timestamp: poll.timestamp,
      optionCount: poll.options.length,
      participantCount: poll.votes.length,
      optionResults: sortedOptions.map(([name, voteCount]) => ({ name, voteCount }))
    });
  });

  const denominator = eligiblePolls.length;
  const ranking = [...members.values()].map((member) => ({
    id: member.id,
    name: member.name,
    pollsParticipated: member.pollsParticipated,
    participationRate: percentage(member.pollsParticipated, denominator),
    alignedPolls: member.alignedPolls,
    alignedRate: percentage(member.alignedPolls, member.pollsParticipated),
    contrarianPolls: member.contrarianPolls,
    contrarianRate: percentage(member.contrarianPolls, member.pollsParticipated),
    validTimingSamples: member.voteDelays.length,
    averageVoteDelaySeconds: member.voteDelays.length
      ? member.voteDelays.reduce((sum, value) => sum + value, 0) / member.voteDelays.length
      : null
  })).sort((a, b) => b.pollsParticipated - a.pollsParticipated
    || b.participationRate - a.participationRate
    || compareNames(a, b));

  const behavioral = ranking.filter((member) => member.pollsParticipated >= minimumSample);
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

  return {
    summary: {
      group: scan?.group && typeof scan.group === 'object'
        ? { id: cleanString(scan.group.id), name: cleanString(scan.group.name) || 'Grupo sem nome' }
        : null,
      pollsFound: Number.isInteger(scan?.pollsFound) ? scan.pollsFound : polls.length,
      eligiblePolls: denominator,
      totalParticipations,
      identifiedParticipants: ranking.length
    },
    mostActive: ranking[0] || null,
    leastActive: [...ranking].sort((a, b) => a.pollsParticipated - b.pollsParticipated
      || a.participationRate - b.participationRate || compareNames(a, b))[0] || null,
    participationRanking: ranking,
    fastestVoter: [...timed].sort((a, b) => a.averageVoteDelaySeconds - b.averageVoteDelaySeconds
      || b.validTimingSamples - a.validTimingSamples || compareNames(a, b))[0] || null,
    mostAligned: [...behavioral].sort((a, b) => b.alignedRate - a.alignedRate
      || b.pollsParticipated - a.pollsParticipated || compareNames(a, b))[0] || null,
    mostContrarian: [...behavioral].sort((a, b) => b.contrarianRate - a.contrarianRate
      || b.pollsParticipated - a.pollsParticipated || compareNames(a, b))[0] || null,
    highestParticipationPoll,
    closestPoll,
    minimumBehaviorSample: minimumSample
  };
}

function percentage(value, total) {
  return total > 0 ? (value / total) * 100 : 0;
}

function compareNames(a, b) {
  return a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }) || a.id.localeCompare(b.id);
}

module.exports = { calculatePollStats, normalizePolls, MIN_BEHAVIOR_SAMPLE };
