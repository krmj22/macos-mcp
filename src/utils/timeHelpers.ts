/**
 * timeHelpers.ts
 * Time formatting and context utilities for prompt templates
 */

import { TIME } from './constants.js';
import { getDateStart, getTodayStart, getTomorrowStart } from './dateUtils.js';

/**
 * Time context information for prompts
 */
export interface TimeContext {
  /** Current date and time in ISO format (UTC) */
  currentDateTime: string;
  /** Current date in YYYY-MM-DD format (local timezone) */
  currentDate: string;
  /** Current time in HH:MM format (local timezone) */
  currentTime: string;
  /** Day of the week (Monday, Tuesday, etc.) */
  dayOfWeek: string;
  /** Whether it's currently working hours (9am-6pm) */
  isWorkingHours: boolean;
  /** Time of day description */
  timeOfDay: 'morning' | 'afternoon' | 'evening' | 'night';
  /** Formatted time description for prompts */
  timeDescription: string;
}

/**
 * Get comprehensive time context for prompt templates
 */
export function getTimeContext(): TimeContext {
  const now = new Date();
  const today = getTodayStart();

  // Use system local timezone for date formatting
  // Format: YYYY-MM-DD in local timezone (not UTC)
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  const currentDate = `${year}-${month}-${day}`;

  // Keep ISO format for full datetime
  const currentDateTime = now.toISOString();

  // Local time in HH:MM format
  const currentTime = now.toTimeString().slice(0, 5); // HH:MM

  // Day of week
  const dayOfWeek = now.toLocaleDateString('en-US', { weekday: 'long' });

  // Working hours check (9am-6pm)
  const hour = now.getHours();
  const isWorkingHours =
    hour >= TIME.WORKING_HOURS_START && hour < TIME.WORKING_HOURS_END;

  // Time of day categorization
  let timeOfDay: TimeContext['timeOfDay'];
  if (hour >= TIME.MORNING_START && hour < TIME.NOON) {
    timeOfDay = 'morning';
  } else if (hour >= TIME.NOON && hour < TIME.AFTERNOON_END) {
    timeOfDay = 'afternoon';
  } else if (hour >= TIME.EVENING_START && hour < TIME.NIGHT_START) {
    timeOfDay = 'evening';
  } else {
    timeOfDay = 'night';
  }

  // Human-readable time description
  const timeDescription = formatTimeDescription(
    now,
    dayOfWeek,
    timeOfDay,
    isWorkingHours,
  );

  return {
    currentDateTime,
    currentDate,
    currentTime,
    dayOfWeek,
    isWorkingHours,
    timeOfDay,
    timeDescription,
  };
}

const TIME_OF_DAY_LABELS: Record<TimeContext['timeOfDay'], string> = {
  morning: ' (morning)',
  afternoon: ' (afternoon)',
  evening: ' (evening)',
  night: ' (night)',
};

/**
 * Create a human-readable time description for prompts
 */
function formatTimeDescription(
  now: Date,
  dayOfWeek: string,
  timeOfDay: TimeContext['timeOfDay'],
  isWorkingHours: boolean,
): string {
  const timeStr = now.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  return `Current time: ${dayOfWeek} at ${timeStr}${TIME_OF_DAY_LABELS[timeOfDay] || ''}${isWorkingHours ? ' - working hours' : ' - outside working hours'}`;
}

/**
 * Format a relative time description for scheduling
 */
export function formatRelativeTime(targetDate: Date): string {
  const today = getTodayStart();
  const tomorrow = getTomorrowStart();
  const targetDay = getDateStart(targetDate);

  if (targetDay.getTime() === today.getTime()) {
    return `today at ${targetDate.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    })}`;
  } else if (targetDay.getTime() === tomorrow.getTime()) {
    return `tomorrow at ${targetDate.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    })}`;
  } else {
    return targetDate.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  }
}

/**
 * Get fuzzy time suggestions based on current time
 */
export function getFuzzyTimeSuggestions(): {
  laterToday: string;
  tomorrow: string;
  endOfWeek: string;
  nextWeek: string;
} {
  const now = new Date();
  const hour = now.getHours();

  // Later today
  const laterToday = new Date(now);
  laterToday.setHours(
    Math.min(hour + TIME.LATER_TODAY_HOURS, TIME.END_OF_WEEK_HOUR),
    0,
    0,
    0,
  );

  // Tomorrow morning
  const tomorrow = getTomorrowStart();
  tomorrow.setHours(TIME.DEFAULT_MORNING_HOUR, 0, 0, 0);

  // End of week (Friday 5pm)
  const endOfWeek = new Date(now);
  const currentDay = now.getDay(); // 0 = Sunday, 6 = Saturday
  const daysUntilFriday =
    currentDay === TIME.SUNDAY
      ? TIME.FRIDAY
      : currentDay <= TIME.FRIDAY
        ? TIME.FRIDAY - currentDay
        : 12 - currentDay;
  endOfWeek.setDate(now.getDate() + daysUntilFriday);
  endOfWeek.setHours(TIME.END_OF_WEEK_HOUR, 0, 0, 0);

  // Next week
  const nextWeek = new Date(now);
  nextWeek.setDate(now.getDate() + 7);
  nextWeek.setHours(TIME.DEFAULT_MORNING_HOUR, 0, 0, 0);

  return {
    laterToday: formatRelativeTime(laterToday),
    tomorrow: formatRelativeTime(tomorrow),
    endOfWeek: formatRelativeTime(endOfWeek),
    nextWeek: formatRelativeTime(nextWeek),
  };
}
