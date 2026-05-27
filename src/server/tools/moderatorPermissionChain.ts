import type { Form } from '@devvit/shared-types/shared/form.js';
import type { ModeratorPermission } from '@devvit/reddit';
import { context, reddit, redis, settings } from '@devvit/web/server';

export const MODERATOR_PERMISSION_CHAIN_REASON =
  'Moderator permission chain: assigned full permissions to remaining moderator';

const CONFIG_KEY = 'moderator-permission-chain:config';
const ENABLED_SETTING = 'moderatorPermissionChainEnabled';
const INACTIVITY_DAYS_SETTING = 'moderatorPermissionChainInactivityDays';
const DEFAULT_INACTIVITY_DAYS = 90;
const DAY_IN_MS = 24 * 60 * 60 * 1000;

const ALL_MODERATOR_PERMISSIONS: ModeratorPermission[] = [
  'all',
];

type ModeratorPermissionChainConfig = {
  enabled: boolean;
  inactivityDays: number;
};

type ModeratorPermissionChainFormValues = {
  enabled?: boolean;
  inactivityDays?: number;
  runCheckNow?: boolean;
};

type ModActionSignal = {
  action?: string;
};

type ModeratorSnapshot = {
  username: string;
  permissions: ModeratorPermission[];
};

type ModeratorPermissionChainResult = {
  status: 'assigned' | 'skipped';
  reason: string;
  username?: string;
};

const getSettingsConfig = async (): Promise<ModeratorPermissionChainConfig> => {
  const [enabled, inactivityDays] = await Promise.all([
    settings.get(ENABLED_SETTING),
    settings.get(INACTIVITY_DAYS_SETTING),
  ]);

  return {
    enabled: typeof enabled === 'boolean' ? enabled : false,
    inactivityDays: positiveInteger(inactivityDays, DEFAULT_INACTIVITY_DAYS),
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const positiveInteger = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.max(1, Math.floor(value))
    : fallback;

const parseConfig = (
  value: string | undefined,
  fallback: ModeratorPermissionChainConfig
): ModeratorPermissionChainConfig => {
  if (!value) {
    return fallback;
  }

  try {
    const parsed: unknown = JSON.parse(value);

    if (!isRecord(parsed)) {
      return fallback;
    }

    return {
      enabled: typeof parsed.enabled === 'boolean' ? parsed.enabled : fallback.enabled,
      inactivityDays: positiveInteger(
        parsed.inactivityDays,
        fallback.inactivityDays
      ),
    };
  } catch {
    return fallback;
  }
};

const getConfig = async () =>
  parseConfig(await redis.get(CONFIG_KEY), await getSettingsConfig());

const saveConfig = async (config: ModeratorPermissionChainConfig) => {
  await redis.set(CONFIG_KEY, JSON.stringify(config));
};

const normalizeUsername = (username: string) => username.toLowerCase();

const isHumanModerator = (username: string) =>
  normalizeUsername(username) !== 'automoderator';

const hasFullPermissions = (permissions: ModeratorPermission[]) =>
  permissions.includes('all');

const getCurrentModerators = async (
  subredditName: string
): Promise<ModeratorSnapshot[]> => {
  const users = await reddit
    .getModerators({
      subredditName,
      limit: 100,
      pageSize: 100,
    })
    .all();

  return await Promise.all(
    users
      .filter((user) => isHumanModerator(user.username))
      .map(async (user) => ({
        username: user.username,
        permissions: await user.getModPermissionsForSubreddit(subredditName),
      }))
  );
};

const getActiveModeratorNames = async (
  subredditName: string,
  inactivityDays: number
) => {
  const cutoffMs = Date.now() - inactivityDays * DAY_IN_MS;
  const actions = await reddit
    .getModerationLog({
      subredditName,
      limit: 1000,
      pageSize: 100,
    })
    .all();

  return new Set(
    actions
      .filter((action) => action.createdAt.getTime() >= cutoffMs)
      .map((action) => normalizeUsername(action.moderatorName))
  );
};

const selectRemainingModerator = (moderators: ModeratorSnapshot[]) =>
  moderators.find((moderator) => !hasFullPermissions(moderator.permissions)) ??
  moderators[0];

const assignFullPermissions = async (
  subredditName: string,
  username: string,
  reason: string
): Promise<ModeratorPermissionChainResult> => {
  await reddit.setModeratorPermissions(
    username,
    subredditName,
    ALL_MODERATOR_PERMISSIONS
  );

  return {
    status: 'assigned',
    reason,
    username,
  };
};

const shouldRunForModAction = (input: ModActionSignal) => {
  if (!input.action) {
    return true;
  }

  return [
    'acceptmoderatorinvite',
    'addmoderator',
    'invitemoderator',
    'removemoderator',
    'setpermissions',
    'uninvitemoderator',
  ].includes(input.action);
};

export const checkModeratorPermissionChain = async (
  triggerReason: string
): Promise<ModeratorPermissionChainResult> => {
  const config = await getConfig();

  if (!config.enabled) {
    return {
      status: 'skipped',
      reason: 'moderator permission chain is disabled',
    };
  }

  if (!context.subredditName) {
    return {
      status: 'skipped',
      reason: 'subreddit context is unavailable',
    };
  }

  const moderators = await getCurrentModerators(context.subredditName);

  if (moderators.length === 0) {
    return {
      status: 'skipped',
      reason: 'no human moderators are available for permission assignment',
    };
  }

  const fullPermissionModerators = moderators.filter((moderator) =>
    hasFullPermissions(moderator.permissions)
  );
  const remainingModerator = selectRemainingModerator(moderators);

  if (!remainingModerator) {
    return {
      status: 'skipped',
      reason: 'no remaining moderator could be selected',
    };
  }

  if (fullPermissionModerators.length === 0) {
    return assignFullPermissions(
      context.subredditName,
      remainingModerator.username,
      `${MODERATOR_PERMISSION_CHAIN_REASON}; no current moderator has full permissions after ${triggerReason}`
    );
  }

  const activeModeratorNames = await getActiveModeratorNames(
    context.subredditName,
    config.inactivityDays
  );
  const activeCurrentModerators = moderators.filter((moderator) =>
    activeModeratorNames.has(normalizeUsername(moderator.username))
  );

  if (activeCurrentModerators.length > 0) {
    return {
      status: 'skipped',
      reason: `${activeCurrentModerators.length} moderator(s) have activity in the last ${config.inactivityDays} days`,
    };
  }

  return assignFullPermissions(
    context.subredditName,
    remainingModerator.username,
    `${MODERATOR_PERMISSION_CHAIN_REASON}; all current moderators inactive for ${config.inactivityDays} days`
  );
};

const buildModeratorPermissionChainForm = (
  config: ModeratorPermissionChainConfig
): Form => ({
  title: 'Configure moderator permission chain',
  description:
    'Assign full moderator permissions to a remaining moderator when the current mod list has no full-permission moderator or all current moderators have no recent mod log activity.',
  acceptLabel: 'Save chain',
  cancelLabel: 'Cancel',
  fields: [
    {
      type: 'boolean',
      name: 'enabled',
      label: 'Enable moderator permission chain',
      defaultValue: config.enabled,
      helpText: 'Runs from mod action events and when this form is saved with a manual check.',
    },
    {
      type: 'number',
      name: 'inactivityDays',
      label: 'Inactive period in days',
      defaultValue: config.inactivityDays,
      helpText: 'Use 90 days for roughly 3 months.',
    },
    {
      type: 'boolean',
      name: 'runCheckNow',
      label: 'Run a chain check after saving',
      defaultValue: false,
      helpText: 'Checks the current mod list and recent moderation log immediately.',
    },
  ],
});

export const moderatorPermissionChainForm =
  buildModeratorPermissionChainForm({
    enabled: false,
    inactivityDays: DEFAULT_INACTIVITY_DAYS,
  });

export const openModeratorPermissionChainForm = async () =>
  buildModeratorPermissionChainForm(await getConfig());

export const saveModeratorPermissionChainForm = async (
  values: ModeratorPermissionChainFormValues
) => {
  const config = {
    enabled: values.enabled === true,
    inactivityDays: positiveInteger(
      values.inactivityDays,
      DEFAULT_INACTIVITY_DAYS
    ),
  };

  await saveConfig(config);

  if (values.runCheckNow === true) {
    const result = await checkModeratorPermissionChain('manual check');

    return {
      config,
      result,
    };
  }

  return {
    config,
  };
};

export const handleModeratorPermissionChainModAction = async (
  input: ModActionSignal
) => {
  if (!shouldRunForModAction(input)) {
    return {
      status: 'skipped',
      reason: `mod action ${input.action} does not affect moderator permissions`,
    } satisfies ModeratorPermissionChainResult;
  }

  return checkModeratorPermissionChain(`mod action ${input.action ?? 'unknown'}`);
};
