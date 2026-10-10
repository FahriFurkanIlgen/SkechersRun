/**
 * Core data models shared across the app. These mirror the backend schema in
 * `supabase/migrations` (snake_case there, camelCase here).
 */

export type ActivityType = 'walk' | 'run' | 'ride';

export type Visibility = 'public' | 'followers' | 'private';

export type AthleteLevel = 'beginner' | 'experienced';

export type UnitSystem = 'metric' | 'imperial';

/** How a shared activity's route is shown to others (privacy zones always apply). */
export type RouteShare = 'trimmed' | 'stats_only' | 'full';

/** Where an activity was recorded. */
/** runner_watch = recorded by the Runner Apple Watch app (delivered via Apple Health). */
export type ActivitySource = 'phone' | 'apple_health' | 'health_connect' | 'runner_watch';

export interface User {
  id: string;
  username: string;
  avatarUrl: string | null;
  preferredActivity: ActivityType;
  level: AthleteLevel;
  profileVisibility: Visibility;
  defaultActivityVisibility: Visibility;
  createdAt: string;
}

/** A single GPS fix captured during an activity. */
export interface RoutePoint {
  /** Sequence within the activity, strictly increasing. */
  seq: number;
  /** Pause/resume splits the route into segments; distance is never bridged across segments. */
  segment: number;
  latitude: number;
  longitude: number;
  /** Horizontal accuracy radius in meters, as reported by the OS. */
  accuracy: number;
  altitude: number | null;
  /** Device-reported speed in m/s, null if unavailable. */
  speed: number | null;
  /** Epoch milliseconds. */
  timestamp: number;
  /** Android reports whether the fix came from a mock provider. */
  mocked: boolean;
}

/** Local lifecycle of an activity on the device. */
export type ActivitySyncState =
  | 'local_only' // backend not configured or user not signed in
  | 'pending_upload' // waiting for connectivity / retry
  | 'uploaded' // server accepted and processed the activity
  | 'rejected'; // server validation rejected it

/** Server-side processing result of a submitted activity. */
export interface ClaimResult {
  status: 'accepted' | 'rejected';
  reasons: string[];
  distanceM: number;
  claimedCells: number;
  /** Cells this player did not own before. */
  netGainCells: number;
  /** Cells taken from other players. */
  capturedCells: number;
  capturedFromUsers: number;
}

export interface Activity {
  /** Client-generated UUID; also used as the idempotency key on the server. */
  id: string;
  remoteId: string | null;
  type: ActivityType;
  title: string;
  visibility: Visibility;
  routeShare: RouteShare;
  source: ActivitySource;
  /** Workout identifier in the source platform (e.g. HealthKit UUID). */
  externalId: string | null;
  /** Recording device for imports, e.g. "Apple Watch". */
  sourceDevice: string | null;
  startedAt: number;
  endedAt: number;
  /** Time spent moving (excludes pauses), seconds. */
  movingTimeS: number;
  distanceM: number;
  /** Device-side estimate of claimed cells; the server value in `claim` is authoritative. */
  estimatedCells: number;
  /** Fastest 5 km / 10 km inside this activity, seconds (null if not covered). */
  best5kS: number | null;
  best10kS: number | null;
  syncState: ActivitySyncState;
  claim: ClaimResult | null;
  lastSyncError: string | null;
}

/** One owned hexagon cell on the map (geometry is derived from q/r, see domain/hex.ts). */
export interface TerritoryCell {
  q: number;
  r: number;
  ownerId: string;
  /** null when the owner's profile is private. */
  username: string | null;
  isMine: boolean;
}

export interface Club {
  id: string;
  name: string;
  description: string | null;
  ownerId: string;
  inviteCode: string;
  memberCount: number;
  isMember: boolean;
  createdAt: string;
}

export interface Follow {
  followerId: string;
  followeeId: string;
  status: 'pending' | 'accepted';
  createdAt: string;
}

export interface FeedPost {
  id: string;
  activityId: string;
  userId: string;
  username: string;
  avatarUrl: string | null;
  activityType: ActivityType;
  title: string;
  distanceM: number;
  movingTimeS: number;
  netGainCells: number;
  /** Trimmed + privacy-zone-filtered route, or null when the owner hides it. */
  publicRoute: [number, number][] | null;
  likeCount: number;
  likedByMe: boolean;
  createdAt: string;
}

export type NotificationKind =
  | 'activity_completed'
  | 'territory_gained'
  | 'territory_lost'
  | 'follow_request'
  | 'new_follower'
  | 'club_invite';

export interface AppNotification {
  id: string;
  kind: NotificationKind;
  payload: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationPrefs {
  enabled: boolean;
  /** Local daily reminder (at most once a day). */
  movementReminders: boolean;
  /** Local weekly summary reminder on Sunday evening. */
  weeklySummary: boolean;
  activityCompleted: boolean;
  territoryChanges: boolean;
  followRequests: boolean;
  clubInvites: boolean;
}
