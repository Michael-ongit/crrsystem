export const IST_TIME_ZONE = 'Asia/Kolkata';

const IST_OFFSET_MINUTES = 5 * 60 + 30;
const dateTimeFormatter = new Intl.DateTimeFormat('en-IN', {
  dateStyle: 'medium',
  timeStyle: 'short',
  hour12: true,
  timeZone: IST_TIME_ZONE,
});
const dateFormatter = new Intl.DateTimeFormat('en-IN', {
  dateStyle: 'medium',
  timeZone: IST_TIME_ZONE,
});
const inputPartsFormatter = new Intl.DateTimeFormat('en-GB', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: IST_TIME_ZONE,
});

const pad = (value: number) => String(value).padStart(2, '0');

const parseISTWallClock = (date: string, time = '00:00:00') => {
  const [year, month, day] = date.split('-').map(Number);
  const [hour = 0, minute = 0, second = 0] = time.split(':').map((part) => Number(part.split('.')[0]));

  if ([year, month, day, hour, minute, second].some((part) => !Number.isFinite(part))) {
    return null;
  }

  return new Date(Date.UTC(year, month - 1, day, hour, minute, second) - IST_OFFSET_MINUTES * 60 * 1000);
};

export const parseApiDateTime = (value?: string | Date | null) => {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;

  const raw = value.trim();
  if (!raw) return null;

  const dateTimeMatch = raw.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)/);
  const hasExplicitZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw);
  if (dateTimeMatch && !hasExplicitZone) {
    return parseISTWallClock(dateTimeMatch[1], dateTimeMatch[2]);
  }

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const inputParts = (value?: string | Date | null) => {
  const date = parseApiDateTime(value) || new Date();
  const parts = inputPartsFormatter.formatToParts(date);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return {
    year: byType.year,
    month: byType.month,
    day: byType.day,
    hour: byType.hour === '24' ? '00' : byType.hour,
    minute: byType.minute,
  };
};

export const formatDateTimeIST = (value?: string | Date | null) => {
  const date = parseApiDateTime(value);
  return date ? `${dateTimeFormatter.format(date)} IST` : '-';
};

export const formatDateIST = (value?: string | Date | null) => {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = parseApiDateTime(value);
  return date ? dateFormatter.format(date) : '-';
};

export const toDateInputIST = (value?: string | Date | null) => {
  const parts = inputParts(value);
  return `${parts.year}-${parts.month}-${parts.day}`;
};

export const toTimeInputIST = (value?: string | Date | null) => {
  const parts = inputParts(value);
  return `${parts.hour}:${parts.minute}`;
};

export const TIME_INPUT_STEP_SECONDS = 300;

export const toDateTimeLocalInputIST = (value?: string | Date | null) =>
  `${toDateInputIST(value)}T${toTimeInputIST(value)}`;

export const combineISTDateTimeForApi = (date: string, time: string) => {
  const normalizedTime = time.length === 5 ? `${time}:00` : time;
  return `${date}T${normalizedTime}`;
};

export const dateTimeLocalInputToApi = (value: string) => {
  const [date, time = '00:00'] = value.split('T');
  return combineISTDateTimeForApi(date, time);
};

export const addHoursToApiDateTime = (value: string, hours: number) => {
  const date = parseApiDateTime(value);
  if (!date) return undefined;
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
};

export const nowLocalIso = () => {
  const now = new Date();
  const parts = inputParts(now);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${pad(now.getSeconds())}`;
};
