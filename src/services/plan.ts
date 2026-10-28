import { db, alive } from '../db/db';
import { build, patch, remove, saveMany } from '../db/write';
import { STARTER_TASKS } from '../domain/plan';
import type { EventTask, TaskSection } from '../db/types';

/** Give an event the starter checklist (skipped if it already has one). */
export async function addStarterTasks(eventId: string): Promise<void> {
  if ((await db.eventTasks.where('eventId').equals(eventId).count()) > 0) return;
  await saveMany(
    db.eventTasks,
    STARTER_TASKS.map((t, i) => build<EventTask>({ eventId, section: t.section, text: t.text, qty: t.qty ?? null, done: 0, doneBy: null, sort: i })),
  );
}

/** A past event's checklist for a new one, all unticked. */
export async function copyTasks(fromEventId: string, toEventId: string): Promise<number> {
  const src = alive(await db.eventTasks.where('eventId').equals(fromEventId).toArray());
  if (!src.length) return 0;
  await saveMany(
    db.eventTasks,
    src.sort((a, b) => a.sort - b.sort).map((t, i) => build<EventTask>({ eventId: toEventId, section: t.section, text: t.text, qty: t.qty, done: 0, doneBy: null, sort: i })),
  );
  return src.length;
}

export async function addTask(eventId: string, section: TaskSection, text: string, qty: number | null = null): Promise<void> {
  const clean = text.trim();
  if (!clean) return;
  const all = alive(await db.eventTasks.where('eventId').equals(eventId).toArray());
  const sort = all.reduce((m, t) => Math.max(m, t.sort), -1) + 1;
  await saveMany(db.eventTasks, [build<EventTask>({ eventId, section, text: clean, qty, done: 0, doneBy: null, sort })]);
}

export async function setTaskDone(id: string, done: boolean, by: string | null): Promise<void> {
  await patch(db.eventTasks, id, { done: done ? 1 : 0, doneBy: done ? by : null });
}

export async function updateTask(id: string, changes: Partial<Pick<EventTask, 'text' | 'qty' | 'section'>>): Promise<void> {
  await patch(db.eventTasks, id, changes);
}

export async function deleteTask(id: string): Promise<void> {
  await remove(db.eventTasks, id);
}
