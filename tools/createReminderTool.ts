import { Tool } from '@builderbot/bot';
import { MongoClient } from 'mongodb';

interface ReminderInput {
  wa_id: string;
  title: string;
  datetime: string; // ISO 8601 format
}

export const createReminderTool: Tool = {
  name: 'createReminderTool',
  description: 'Creates a reminder in the MongoDB for a WhatsApp user.',
  parameters: {
    type: 'object',
    properties: {
      wa_id: {
        type: 'string',
        description: 'WhatsApp user ID',
      },
      title: {
        type: 'string',
        description: 'Reminder text',
      },
      datetime: {
        type: 'string',
        description: 'Reminder time in ISO 8601 format',
      },
    },
    required: ['wa_id', 'title', 'datetime'],
  },
  run: async (input: ReminderInput) => {
    const uri = process.env.MONGODB_URI!;
    const client = new MongoClient(uri);

    try {
      await client.connect();
      const db = client.db('whatsapp_ai');
      const reminders = db.collection('reminders');

      const newReminder = {
        wa_id: input.wa_id,
        title: input.title,
        datetime: input.datetime,
        createdAt: new Date(),
        status: 'pending',
      };

      await reminders.insertOne(newReminder);
      return `Reminder "${input.title}" was created for ${input.datetime}`;
    } catch (err: any) {
      console.error('Failed to create reminder:', err.message);
      throw new Error('Failed to create reminder');
    } finally {
      await client.close();
    }
  },
};
