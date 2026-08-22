export type ConnectionStatusName =
  | 'disconnected'
  | 'waiting_qr'
  | 'connecting'
  | 'connected'
  | 'auth_failure';

export interface ConnectionStatus {
  status: ConnectionStatusName;
  connected: boolean;
  hasQrCode: boolean;
  error: string | null;
}

export interface Group { id: string; name: string }
export interface LocalGroup extends Group { pollCount: number; lastSyncAt: number | null }
export interface Member {
  id: string;
  name: string;
  numberHint: string | null;
  profilePicUrl: string | null;
}

export interface GroupMembersResponse { members: Member[]; totalMembers: number }
export interface GroupsResponse { groups: Group[] }
export interface LocalGroupsResponse { groups: LocalGroup[] }
export interface QrResponse { dataUrl: string }
export interface ProfilePictureResponse { profilePicUrl: string | null }
export interface LogoutResponse { success: true; message: string; status: ConnectionStatus }
export interface SendPollInput {
  groupId: string;
  question: string;
  options: string[];
  allowMultipleAnswers: boolean;
}
export interface SendPollResponse { success: true; message: string; messageId?: string }

export interface PollVote {
  voterId: string | null;
  voterName: string | null;
  selectedOptionIds: unknown[];
  selectedOptions: string[];
  timestamp: number | null;
}
export interface PollScanPoll {
  messageId: string | null;
  question: string;
  timestamp: number | null;
  creatorId: string | null;
  creatorName: string | null;
  authorId?: string | null;
  authorName?: string | null;
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
  polls: PollScanPoll[];
}

export type SyncDirection = 'newer' | 'older';
export interface GroupSyncStatus {
  groupId: string;
  messagesProcessed: number;
  oldestProcessedTimestamp: number | null;
  newestProcessedTimestamp: number | null;
  lastSyncAt: number | null;
}
export interface IncrementalSyncResult {
  direction: SyncDirection;
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
export type HistoryPreparationStatusName =
  | 'preparing' | 'completed' | 'stabilized' | 'cancelled' | 'timeout' | 'error';
export interface HistoryPreparationStatus {
  status: HistoryPreparationStatusName;
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

export interface PollHistoryCreator { id: string; displayName: string }
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
export interface PollHistoryPagination { page: number; pageSize: number; totalItems: number; totalPages: number }
export interface PollHistoryListResult { items: PollHistoryItem[]; pagination: PollHistoryPagination }
export interface PollHistoryOption { id: number; text: string; position: number; selectionCount: number | null }
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

export interface MemberIdentity { id: string; name: string }
export interface MemberStats extends MemberIdentity {
  pollsParticipated: number; participationRate: number; alignedPolls: number; alignedRate: number;
  contrarianPolls: number; contrarianRate: number; behaviorPolls: number; unpredictability: number;
  lastPlacePolls: number; lastPlaceEligiblePolls: number; lastPlaceRate: number;
  validTimingSamples: number; averageVoteDelaySeconds: number | null;
}
export interface PairAffinity {
  memberA: MemberIdentity; memberB: MemberIdentity; members: MemberIdentity[];
  pollsTogether: number; averageSimilarity: number; oppositionScore: number;
  similarityRate: number; oppositionRate: number;
}
export interface PollOptionResult { name: string; voteCount: number }
export interface PollResult {
  id: string; question: string; timestamp: number | null; optionCount: number;
  participantCount: number; optionResults: PollOptionResult[];
}
export interface TimingLeader extends MemberIdentity {
  count: number; percentage: number; leaders: Array<MemberIdentity & { count: number; percentage: number }>;
  eligiblePolls: number; ranking: Array<MemberIdentity & { count: number; percentage: number }>;
}
export interface DayActivity { name: string; shortLabel: string; count: number; percentage: number }
export interface HourActivity { hour: number; label: string; rangeLabel: string; count: number; percentage: number }
export interface CreatorStats extends MemberIdentity { pollsCreated: number; percentage: number }
export interface StatsResult {
  summary: {
    group: Group | null; pollsFound: number; eligiblePolls: number; totalParticipations: number;
    identifiedParticipants: number; validTimestampVotes: number; timedPolls: number;
    identifiedCreators: number; pollsWithIdentifiedCreator: number;
  };
  mostActive: MemberStats | null; leastActive: MemberStats | null; participationRanking: MemberStats[];
  fastestVoter: MemberStats | null; mostAligned: MemberStats | null; mostContrarian: MemberStats | null;
  mostUnpredictable: MemberStats | null; unluckiestMember: MemberStats | null;
  firstVoter: TimingLeader | null; lastVoter: TimingLeader | null; eligibleMembers: MemberStats[];
  pairs: PairAffinity[]; similarityRanking: PairAffinity[]; oppositionRanking: PairAffinity[];
  mostSimilarPair: PairAffinity | null; mostOppositePair: PairAffinity | null;
  mostActiveDay: (DayActivity & { distribution: DayActivity[] }) | null;
  primeTime: (HourActivity & { topHours: HourActivity[] }) | null;
  topPollCreator: CreatorStats | null; leastPollCreator: CreatorStats | null;
  onlyOneIdentifiedCreator: boolean; creatorRanking: CreatorStats[]; pollsWithIdentifiedCreator: number;
  highestParticipationPoll: PollResult | null;
  closestPoll: (PollResult & { leaders: PollOptionResult[]; difference: number }) | null;
  minimumBehaviorSample: number; minimumExtendedSample: number; minimumPairSample: number;
  minimumBehaviorParticipationRate: number; statsTimezone: string;
}
export interface PersistedStatsResult { stats: StatsResult; localData: GroupSyncStatus }
