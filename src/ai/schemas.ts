import * as z from 'zod/v4'

const CHANNEL_TYPES = ['phone', 'telegram', 'whatsapp', 'email', 'instagram', 'linkedin', 'x', 'website'] as const
const INTERACTION_TYPES = ['meeting', 'call', 'message', 'event', 'favor_given', 'favor_got', 'gift', 'note'] as const

/* ---------- Voice capture / event mode ---------- */

export const PersonDraftSchema = z.object({
  ref: z.string().describe('A short label of the person inside the answer: p1, p2…'),
  existing_id: z.string().nullable().describe('id from the network list if this is already a known person; otherwise null'),
  first_name: z.string(),
  last_name: z.string().nullable(),
  role: z.string().nullable(),
  company: z.string().nullable(),
  city: z.string().nullable().describe('Where they live now'),
  family: z.string().nullable().describe('Close family: "wife Maria, son Leo (5)"'),
  facts: z.array(z.string()).describe('Memorable details: what they like, habits, hobbies'),
  interests: z.array(z.string()).describe('Short tags: AI, running, wine'),
  looking_for: z.string().nullable().describe('What the person is looking for now or needs'),
  can_help: z.string().nullable().describe('What they are strong at and can help with'),
  i_can_help: z.string().nullable().describe('How I can help them'),
  channels: z.array(z.object({ type: z.enum(CHANNEL_TYPES), value: z.string() })),
  birthday: z.string().nullable().describe('YYYY-MM-DD, or --MM-DD if the year is unknown'),
  met_place: z.string().nullable(),
  introduced_by_id: z.string().nullable().describe('id from the network list — who introduced them'),
  topics: z.array(z.string()).describe('What to ask about next time'),
  gift_ideas: z.string().nullable(),
})

export const CaptureSchema = z.object({
  summary: z.string().describe('One short sentence: what happened'),
  people: z.array(PersonDraftSchema),
  interaction: z
    .object({
      type: z.enum(INTERACTION_TYPES),
      title: z.string().describe('Short: "Dinner at the bistro"'),
      summary: z.string().describe('What was discussed — 1–3 sentences'),
      place: z.string().nullable(),
      person_refs: z.array(z.string()),
    })
    .nullable(),
  reminders: z.array(
    z.object({
      person_ref: z.string().nullable(),
      text: z.string().describe('The action: "Call Artem"'),
      due_date: z.string().describe('YYYY-MM-DD'),
    }),
  ),
})
export type CapturePlan = z.infer<typeof CaptureSchema>
export type PersonDraft = z.infer<typeof PersonDraftSchema>

/* ---------- Brief before a meeting ---------- */

export const BriefSchema = z.object({
  headline: z.string().describe('The main thing about the person and your connection in one sentence'),
  who: z.string().describe('Who this is: role, context, how you are connected'),
  last_time: z.string().describe('What happened last time'),
  promises_mine: z.array(z.string()).describe('What I promised'),
  promises_theirs: z.array(z.string()).describe('What was promised to me'),
  ask_about: z.array(z.string()).describe('What to ask about — concrete questions'),
  details: z.array(z.string()).describe('Personal details worth remembering'),
  you_can_help: z.array(z.string()).describe('How I can be useful, including introductions to people from the network'),
  careful: z.array(z.string()).describe('Delicate topics to keep in mind'),
  opener: z.string().describe('A phrase to start the conversation naturally'),
})
export type Brief = z.infer<typeof BriefSchema>

/* ---------- Ask the network ---------- */

export const AskSchema = z.object({
  answer: z.string().describe('A short to-the-point answer, 1–3 sentences'),
  people: z.array(z.object({ id: z.string(), reason: z.string().describe('Why exactly this person — be specific') })),
  follow_ups: z.array(z.string()).describe('2–3 follow-up questions that can be asked next'),
})
export type AskResult = z.infer<typeof AskSchema>

/* ---------- Suggestions from notes ---------- */

export const NoteSuggestSchema = z.object({
  items: z.array(
    z.object({
      kind: z.enum(['reminder', 'fact', 'topic', 'family', 'looking_for', 'can_help', 'birthday', 'interest', 'gift']),
      text: z.string(),
      due_date: z.string().nullable().describe('For reminder: YYYY-MM-DD; for birthday: YYYY-MM-DD or --MM-DD'),
    }),
  ),
})
export type NoteSuggestions = z.infer<typeof NoteSuggestSchema>

/* ---------- Message drafts ---------- */

export const DraftsSchema = z.object({
  short: z.string().describe('Short, 1–2 sentences'),
  warm: z.string().describe('Warm and personal'),
  business: z.string().describe('Businesslike, with a concrete proposal'),
})
export type Drafts = z.infer<typeof DraftsSchema>

/* ---------- Matchmaker ---------- */

export const MatchesSchema = z.object({
  matches: z.array(
    z.object({
      a_id: z.string(),
      b_id: z.string(),
      reason: z.string().describe('Why they should meet — in one sentence'),
      value: z.string().describe('What each of them gets'),
      score: z.number().describe('Strength of the match from 0 to 100'),
    }),
  ),
})
export type Matches = z.infer<typeof MatchesSchema>

export const IntroDraftsSchema = z.object({
  to_a: z.string().describe('Personal message to the first: ask whether they want the introduction'),
  to_b: z.string().describe('Personal message to the second: ask whether they want the introduction'),
  group: z.string().describe('Message for the group chat once both agreed'),
})
export type IntroDrafts = z.infer<typeof IntroDraftsSchema>

/* ---------- Weekly brief ---------- */

export const WeeklySchema = z.object({
  headline: z.string().describe('The headline of the week — short and human'),
  narrative: z.string().describe('2–3 sentences: what matters in the network this week'),
  priorities: z.array(z.object({ person_id: z.string(), action: z.string(), why: z.string() })).describe('3–5 main actions of the week'),
})
export type WeeklyAi = z.infer<typeof WeeklySchema>

/* ---------- Chat ---------- */

export const ChatSchema = z.object({
  answer: z.string().describe('A to-the-point answer, 1–4 sentences, no invented facts'),
  people: z.array(z.object({ id: z.string(), reason: z.string().describe('Why this person is mentioned — be specific') })),
  quotes: z.array(z.object({
    person_id: z.string(),
    date: z.string().nullable().describe('YYYY-MM-DD of the record the excerpt comes from; null if there is no date'),
    text: z.string().describe('A short excerpt from the records the user wrote, close to the text'),
    kind: z.enum(['mine', 'theirs', 'agreed', 'topic']).describe('mine — the user promised; theirs — promised to the user; agreed — a shared agreement; topic — just what was discussed'),
  })),
  follow_ups: z.array(z.string()).describe('Up to 3 short questions that are logical to ask next'),
  focus_person_id: z.string().nullable().describe('id of the person being discussed, if there is just one; otherwise null'),
})
export type ChatResult = z.infer<typeof ChatSchema>
