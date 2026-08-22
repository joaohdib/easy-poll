export interface Group {
  id: string;
  name: string;
}

export interface Member {
  id: string;
  name: string;
  numberHint: string | null;
  profilePicUrl: string | null;
}

export interface SendPollInput {
  groupId: string;
  question: string;
  options: string[];
  allowMultipleAnswers: boolean;
}

export interface PollVote {
  voterId: string | null;
  voterName: string | null;
  selectedOptionIds: unknown[];
  selectedOptions: string[];
  timestamp: number | null;
}

export interface Poll {
  messageId: string | null;
  question: string;
  timestamp: number | null;
  creatorId: string | null;
  creatorName: string | null;
  options: string[];
  allowMultipleAnswers: boolean;
  votes: PollVote[];
  voteCount: number;
  votesAvailable: boolean;
  votesError: string | null;
}

export interface PollScanResult {
  group: Group;
  requestedLimit: number;
  messagesScanned: number;
  pollsFound: number;
  pollsWithVotesAvailable: number;
  messageTypes: Record<string, number>;
  polls: Poll[];
}

/**
 * Internal persistence DTOs. They deliberately contain normalized EasyPoll
 * data only; raw WhatsApp messages never cross the persistence boundary.
 */
export interface PersistablePollOption {
  text: string;
  position: number;
  whatsappLocalId: string | null;
}

export interface PersistablePollVote {
  voterId: string | null;
  voterName: string | null;
  selectedOptionIds: string[];
  selectedOptions: string[];
  timestamp: number | null;
}

export interface PersistablePoll {
  messageId: string | null;
  question: string;
  timestamp: number | null;
  creatorId: string | null;
  creatorName: string | null;
  options: PersistablePollOption[];
  allowMultipleAnswers: boolean;
  votes: PersistablePollVote[];
  votesAvailable: boolean;
}

export interface ProcessedMessageMetadata {
  id: string;
  groupId: string;
  type: string;
  timestamp: number;
}

export interface PollScanPersistenceInput {
  group: Group;
  polls: PersistablePoll[];
  processedMessages: ProcessedMessageMetadata[];
}

export interface GroupSyncStatus {
  groupId: string;
  messagesProcessed: number;
  oldestProcessedTimestamp: number | null;
  newestProcessedTimestamp: number | null;
  lastSyncAt: number | null;
}

export interface LocalGroup extends Group {
  pollCount: number;
  lastSyncAt: number | null;
}

export interface PollHistoryCreator {
  id: string;
  displayName: string;
}

export interface PollHistoryItem {
  messageId: string;
  question: string;
  createdAt: number;
  creator: PollHistoryCreator | null;
  allowMultipleAnswers: boolean;
  optionCount: number;
  votesSnapshotAvailable: boolean;
  participantCount: number | null;
  selectionCount: number | null;
}

export interface PollHistoryPagination {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

export interface PollHistoryListResult {
  items: PollHistoryItem[];
  pagination: PollHistoryPagination;
}

export interface PollHistoryOption {
  id: number;
  text: string;
  position: number;
  selectionCount: number | null;
}

export interface PollHistoryParticipant {
  id: string;
  displayName: string;
  votedAt: number | null;
  selectedOptions: Array<Pick<PollHistoryOption, 'id' | 'text' | 'position'>>;
}

export interface PollHistoryDetail {
  messageId: string;
  groupId: string;
  question: string;
  createdAt: number;
  allowMultipleAnswers: boolean;
  creator: PollHistoryCreator | null;
  votesSnapshotAvailable: boolean;
  votesSnapshotAt: number | null;
  participantCount: number | null;
  selectionCount: number | null;
  options: PollHistoryOption[];
  participants: PollHistoryParticipant[] | null;
}

export type IncrementalSyncDirection = 'newer' | 'older';

export interface IncrementalSyncResult {
  direction: IncrementalSyncDirection;
  messagesLoaded: number;
  newMessages: number;
  knownMessages: number;
  messagesPersisted: number;
  pollsFound: number;
  pollsPersisted: number;
  votesReconciled: number;
  oldestProcessedTimestamp: number | null;
  newestProcessedTimestamp: number | null;
  reachedBoundary: boolean;
  boundaryNotFound: boolean;
  reachedAvailableHistoryStart: boolean;
  cancelled: boolean;
  timedOut: boolean;
}

export interface PollParticipant {
  userId: string;
  name: string;
  selectedOptions: string[];
  voteTimestamp: number | null;
}

export interface PollAnalysis {
  id: string;
  question: string;
  timestamp: number | null;
  options: string[];
  votesAvailable: boolean;
  participants: PollParticipant[];
  votes: Array<{
    voterId: string;
    voterName: string;
    selectedOptions: string[];
    timestamp: number | null;
  }>;
  creatorId: string | null;
  creatorName: string | null;
}

export interface PollAnalysisInput {
  group: Group | null;
  pollsFound: number;
  polls: PollAnalysis[];
}

export type HistoryPreparationStatus =
  | 'preparing'
  | 'completed'
  | 'stabilized'
  | 'cancelled'
  | 'timeout'
  | 'error';

export interface HistoryPreparationJob {
  token: symbol;
  groupId: string;
  status: HistoryPreparationStatus;
  messagesAvailable: number;
  initialMessagesAvailable: number;
  attempts: number;
  noGrowthAttempts: number;
  target: number;
  strategy: string;
  detail: string;
  startedAt: string;
  updatedAt: string;
  finishedAt?: string;
  error?: string;
  cancelRequested: boolean;
}

export interface SerializedHistoryPreparation {
  status: HistoryPreparationStatus;
  groupId: string;
  messagesAvailable: number;
  initialMessagesAvailable: number;
  attempts: number;
  noGrowthAttempts: number;
  target: number;
  strategy: string;
  detail: string;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
  error: string | null;
}

export interface MemberIdentity {
  id: string;
  name: string;
}

export interface MemberStats extends MemberIdentity {
  pollsParticipated: number;
  participationRate: number;
  alignedPolls: number;
  alignedRate: number;
  contrarianPolls: number;
  contrarianRate: number;
  behaviorPolls: number;
  unpredictability: number;
  lastPlacePolls: number;
  lastPlaceEligiblePolls: number;
  lastPlaceRate: number;
  validTimingSamples: number;
  averageVoteDelaySeconds: number | null;
}

export interface PairAffinity {
  memberA: MemberIdentity;
  memberB: MemberIdentity;
  members: MemberIdentity[];
  pollsTogether: number;
  averageSimilarity: number;
  oppositionScore: number;
  similarityRate: number;
  oppositionRate: number;
}

export interface PollOptionResult {
  name: string;
  voteCount: number;
}

export interface PollResult {
  id: string;
  question: string;
  timestamp: number | null;
  optionCount: number;
  participantCount: number;
  optionResults: PollOptionResult[];
}

export interface StatsResult {
  summary: {
    group: Group | null;
    pollsFound: number;
    eligiblePolls: number;
    totalParticipations: number;
    identifiedParticipants: number;
    validTimestampVotes: number;
    timedPolls: number;
    identifiedCreators: number;
    pollsWithIdentifiedCreator: number;
  };
  mostActive: MemberStats | null;
  leastActive: MemberStats | null;
  participationRanking: MemberStats[];
  fastestVoter: MemberStats | null;
  mostAligned: MemberStats | null;
  mostContrarian: MemberStats | null;
  mostUnpredictable: MemberStats | null;
  unluckiestMember: MemberStats | null;
  firstVoter: TimingLeader | null;
  lastVoter: TimingLeader | null;
  eligibleMembers: MemberStats[];
  pairs: PairAffinity[];
  similarityRanking: PairAffinity[];
  oppositionRanking: PairAffinity[];
  mostSimilarPair: PairAffinity | null;
  mostOppositePair: PairAffinity | null;
  mostActiveDay: (DayActivity & { distribution: DayActivity[] }) | null;
  primeTime: (HourActivity & { topHours: HourActivity[] }) | null;
  topPollCreator: CreatorStats | null;
  leastPollCreator: CreatorStats | null;
  onlyOneIdentifiedCreator: boolean;
  creatorRanking: CreatorStats[];
  pollsWithIdentifiedCreator: number;
  highestParticipationPoll: PollResult | null;
  closestPoll: (PollResult & { leaders: PollOptionResult[]; difference: number }) | null;
  minimumBehaviorSample: number;
  minimumExtendedSample: number;
  minimumPairSample: number;
  minimumBehaviorParticipationRate: number;
  statsTimezone: string;
}

export interface PersistedStatsResult {
  stats: StatsResult;
  localData: GroupSyncStatus;
}

export interface TimingLeader extends MemberIdentity {
  count: number;
  percentage: number;
  leaders: Array<MemberIdentity & { count: number; percentage: number }>;
  eligiblePolls: number;
  ranking: Array<MemberIdentity & { count: number; percentage: number }>;
}

export interface DayActivity {
  name: string;
  shortLabel: string;
  count: number;
  percentage: number;
}

export interface HourActivity {
  hour: number;
  label: string;
  rangeLabel: string;
  count: number;
  percentage: number;
}

export interface CreatorStats extends MemberIdentity {
  pollsCreated: number;
  percentage: number;
}
