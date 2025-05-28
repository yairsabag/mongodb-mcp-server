import { Tool } from '@builderbot/bot';
import { createReminderTool } from './createReminderTool';

// כאן תוכל לייבא כלים נוספים בעתיד
// import { someOtherTool } from './someOtherTool';

export const tools: Tool[] = [
  createReminderTool,
  // הוסף כאן כלים נוספים בהמשך
];
