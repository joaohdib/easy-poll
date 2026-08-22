# EasyPoll Development Rules

This file contains mandatory instructions for AI coding agents working on EasyPoll.

EasyPoll integrates with WhatsApp through `whatsapp-web.js` and contains compatibility workarounds for behaviors and serialization issues found in the current WhatsApp Web environment.

Some code may look unusual or more complicated than expected because it exists to work around real runtime problems.

**Do not simplify working code without first understanding why it exists.**

---

# 1. Core Principle

Preserve existing behavior unless the current task explicitly requests a change.

A refactor is successful only if the application continues to behave correctly after the refactor.

Do not treat architectural cleanliness as more important than working behavior.

---

# 2. Incremental Changes Only

Prefer small, incremental migrations over complete rewrites.

Do not perform unrelated architectural changes in the same task.

For example, if the task is:

```text
Migrate backend to TypeScript
```

do NOT also:

- migrate the frontend to React;
- introduce SQLite;
- redesign the UI;
- replace Express;
- replace `whatsapp-web.js`;
- restructure the entire repository;
- introduce a new state-management system.

One major architectural change per task.

---

# 3. WhatsApp Integration Is Sensitive

The WhatsApp integration is the most fragile part of EasyPoll.

Before changing WhatsApp-related code:

1. inspect the existing implementation;
2. identify comments and compatibility workarounds;
3. inspect the installed `whatsapp-web.js` version;
4. understand why the current implementation exists;
5. preserve working behavior unless the task specifically requires changing it.

Never rewrite WhatsApp integration code simply because another implementation appears cleaner.

---

# 4. whatsapp-web.js Compatibility Workarounds

EasyPoll may contain workarounds for issues involving:

- Puppeteer serialization;
- WhatsApp Web internal models;
- message IDs;
- poll IDs;
- `_serialized`;
- `Chat` models;
- `getChatById()`;
- `fetchMessages()`;
- poll vote retrieval;
- WhatsApp Web Store APIs;
- `WAWebPollsVotesSchema`;
- history synchronization.

These workarounds exist because the obvious public API has not always behaved correctly in the current WhatsApp Web environment.

Do not replace them with standard `whatsapp-web.js` calls unless the replacement has been verified against a real WhatsApp session.

---

# 5. Known Sensitive Areas

Treat the following areas as compatibility-sensitive.

## Chat retrieval

The project has previously encountered serialization problems when using:

```js
client.getChatById(...)
```

Do not blindly replace existing group/chat retrieval logic with `getChatById()`.

Inspect the current implementation first.

---

## Poll message IDs

Poll IDs may lose their `_serialized` property when crossing the Puppeteer boundary.

Do not assume:

```js
message.id._serialized;
```

will always be available after serialization.

Preserve existing ID recovery logic unless a verified replacement exists.

---

## Poll vote retrieval

The project has required lower-level access to WhatsApp Web poll vote structures when higher-level APIs lost required message IDs during serialization.

Code involving APIs such as:

```text
WAWebPollsVotesSchema
```

must be considered a compatibility workaround.

Do not remove it only because a higher-level method exists in the library.

A higher-level method must be proven to work with real poll data before replacing the workaround.

---

# 6. Do Not Upgrade whatsapp-web.js Casually

Do not upgrade `whatsapp-web.js` as part of an unrelated task.

A library upgrade can change:

- WhatsApp Web compatibility;
- internal Store APIs;
- message structures;
- poll behavior;
- Puppeteer behavior;
- authentication behavior.

Only upgrade it when explicitly requested.

If an upgrade is requested:

1. document the previous version;
2. inspect breaking changes;
3. run tests;
4. verify authentication;
5. verify groups;
6. verify members;
7. verify history synchronization;
8. verify poll creation;
9. verify poll extraction;
10. verify vote extraction.

---

# 7. Never Send Polls Automatically During Tests

Tests must never automatically send a poll or message to a real WhatsApp group.

Do not automate clicking:

```text
Enviar enquete
```

against a connected real WhatsApp session.

Testing may validate:

- forms;
- validation;
- payload construction;
- API behavior using mocks;
- UI states;
- local database behavior;
- statistics;
- navigation.

Real message or poll sending must remain a manual user action unless the task explicitly provides a safe isolated test environment.

---

# 8. Do Not Modify WhatsApp Data

Unless explicitly requested, agents must never:

- delete WhatsApp messages;
- edit WhatsApp messages;
- automatically send messages;
- automatically send polls;
- react to messages;
- modify group membership;
- modify group settings;
- mark large amounts of messages as read;
- alter user profile information.

EasyPoll should behave as a minimally invasive client.

---

# 9. Privacy — Local First

EasyPoll is a local-first application.

Persistent application data must remain on the user's machine.

Do not introduce:

- cloud databases;
- remote persistence;
- analytics platforms;
- telemetry;
- external logging services;
- crash-reporting services that upload user data;
- third-party tracking.

Do not send EasyPoll data to external APIs unless explicitly required by a future task.

---

# 10. Never Persist Normal WhatsApp Conversations

EasyPoll is a poll application, not a WhatsApp archival tool.

Normal conversation contents must not be persisted.

Do not store:

- regular message bodies;
- chat conversation text;
- images;
- videos;
- audio;
- documents;
- stickers;
- attachments.

Messages may be inspected temporarily when necessary to identify poll messages, but non-poll content should be discarded immediately.

---

# 11. Allowed Persistent Data

Future local persistence may store data relevant to EasyPoll, such as:

- group IDs;
- group names;
- member IDs;
- member display names;
- poll IDs;
- poll questions;
- poll options;
- poll creators;
- poll timestamps;
- poll votes;
- vote timestamps;
- message IDs used for deduplication;
- message types;
- synchronization metadata.

This data must remain local.

---

# 12. Processed Message Index

If the project stores information about already processed WhatsApp messages, store only metadata necessary for synchronization and deduplication.

Example:

```text
messageId
groupId
messageType
timestamp
```

Do not store the body of ordinary messages.

---

# 13. Authentication Data

WhatsApp authentication data is sensitive.

Files generated by `LocalAuth`, including `.wwebjs_auth`, must never be:

- committed;
- uploaded;
- copied to logs;
- exposed through APIs;
- returned to the frontend;
- included in debugging output.

Ensure authentication/session directories remain ignored by Git.

---

# 14. QR Codes

WhatsApp QR codes are temporary authentication credentials.

Do not:

- persist QR codes;
- write QR codes to disk;
- log their raw contents unnecessarily;
- send them to external services.

They may exist temporarily in memory and in the local frontend while authentication is pending.

---

# 15. Member Privacy

Only retrieve member information required by EasyPoll features.

Profile pictures:

- should be requested only when needed;
- should not bypass WhatsApp privacy settings;
- should not be downloaded permanently unless a future task explicitly requires local caching;
- failures must fall back gracefully to initials or another local avatar.

Do not attempt to circumvent WhatsApp privacy restrictions.

---

# 16. User Identity

Use stable WhatsApp IDs internally whenever possible.

Never use display names as unique identifiers.

Two members can have the same name.

Conceptually:

```ts
{
  id: string;
  displayName: string;
}
```

The ID identifies the member.

The name is presentation only.

---

# 17. Prefer WhatsApp Display Names

When presenting members, preserve the project's existing name-resolution strategy.

Prefer, when available:

1. the name configured by the person in WhatsApp / push name;
2. other appropriate WhatsApp display names;
3. saved contact name;
4. masked identifier as fallback.

Do not replace this logic with saved contact names only.

---

# 18. Preserve Existing API Behavior

During migrations, preserve existing HTTP endpoints whenever reasonably possible.

If an endpoint currently exists, do not rename or remove it as part of an unrelated refactor.

Examples may include:

```text
GET /api/status
GET /api/qr
GET /api/groups
GET /api/groups/:groupId/members
POST /api/polls
POST /api/groups/:groupId/polls/scan
```

If a migration requires changing an API contract:

1. document why;
2. update all consumers;
3. update tests;
4. verify backward compatibility when practical.

---

# 19. Backend and Frontend Must Not Be Migrated Together

Do not migrate the backend and frontend architecture in the same task.

The intended migration strategy is incremental.

Typical order:

```text
Backend JavaScript
        ↓
Backend TypeScript
        ↓
Backend organization
        ↓
Local persistence
        ↓
Stable APIs
        ↓
Frontend React + TypeScript
```

This separation makes regressions easier to identify.

---

# 20. TypeScript Migration Rules

When migrating existing JavaScript to TypeScript:

- preserve runtime behavior;
- avoid unrelated refactors;
- avoid changing endpoint semantics;
- avoid rewriting WhatsApp logic;
- introduce types incrementally;
- avoid excessive use of `any`;
- create domain types when they represent meaningful EasyPoll concepts.

Examples:

```text
Group
Member
Poll
PollOption
PollVote
PollAnalysis
StatsResult
PairAffinity
```

Do not create excessive abstraction solely to satisfy architectural aesthetics.

---

# 21. Service Responsibilities

As the architecture evolves, prefer clear boundaries.

## WhatsAppService

Responsible for interaction with WhatsApp and `whatsapp-web.js`.

Examples:

- connection;
- QR;
- authentication;
- groups;
- members;
- message retrieval;
- poll sending;
- poll vote retrieval;
- WhatsApp-specific history behavior.

---

## PollService

Responsible for converting WhatsApp poll data into EasyPoll domain structures.

Examples:

- poll normalization;
- option normalization;
- vote normalization;
- creator normalization.

---

## HistoryService / SyncService

Responsible for:

- history preparation;
- synchronization;
- incremental scanning;
- tracking known history ranges;
- discovering new or older messages.

---

## StatsService

Responsible only for statistical calculations.

It should consume normalized EasyPoll data.

It should not directly interact with Puppeteer or WhatsApp Web internals.

---

# 22. Database Rules

When local persistence is introduced:

- use SQLite;
- keep the database local;
- use migrations;
- use constraints where useful;
- prevent duplicate polls;
- prevent duplicate votes;
- prefer stable WhatsApp IDs as identifiers.

Do not introduce PostgreSQL, MySQL, MongoDB, Supabase, Firebase, or another remote database unless explicitly requested.

---

# 23. Database Must Not Become a Conversation Archive

The database exists to support EasyPoll.

Its purpose is:

```text
poll history
poll votes
statistics
sync state
deduplication
```

Its purpose is NOT:

```text
WhatsApp backup
conversation archive
message search engine
```

Keep schemas aligned with that principle.

---

# 24. Synchronization Must Be Incremental

Once persistence exists, prefer incremental synchronization.

Do not repeatedly process tens of thousands of known messages if the project already knows they were processed.

Synchronization should eventually support:

```text
older history ← known local history → newer messages
```

Do not assume every synchronization needs to rebuild the local dataset.

---

# 25. Deduplication

Persisted WhatsApp entities must be deduplicated using stable identifiers whenever available.

Polls should primarily rely on their message ID.

Repeated synchronization must not create duplicate polls or votes.

Prefer:

```text
UPSERT
```

or equivalent safe operations.

---

# 26. Statistics Must Be Deterministic

Statistical calculations should be separated from UI rendering.

Do not calculate complex statistics directly inside DOM or React rendering code.

Prefer pure functions/services that receive normalized input and return deterministic output.

Examples:

```ts
calculateStats(polls);
calculatePairAffinity(polls);
calculateParticipation(polls);
```

Given the same input, they should return the same result.

---

# 27. Statistics Must Handle Missing Data

WhatsApp data may be incomplete.

Statistics must handle:

- missing timestamps;
- unavailable authors;
- polls without votes;
- partial history;
- duplicate names;
- multiple-choice polls;
- tied poll results;
- insufficient sample sizes.

Never display:

```text
NaN
undefined
null%
```

Use explicit insufficient-data states instead.

---

# 28. Do Not Present Partial History as Complete

WhatsApp Web may expose only part of a group's history.

Never claim:

```text
Full group history loaded
```

unless completeness can actually be proven.

Prefer language such as:

```text
History available in this session
Messages currently available
Imported poll history
```

---

# 29. Multiple Choice Polls

EasyPoll supports polls with multiple answers.

Any refactor involving votes or statistics must preserve correct behavior for multiple selected options.

Participation remains:

```text
one participant per poll
```

regardless of how many options they selected.

---

# 30. Local Preferences

Small UI preferences such as:

- favorite groups;
- last selected group;

may remain in `localStorage` unless a future task explicitly migrates them.

Do not move every frontend preference into the database automatically.

---

# 31. Testing Requirements

After every meaningful refactor:

1. run existing automated tests;
2. run type checking when TypeScript exists;
3. run linting when configured;
4. start the application;
5. inspect terminal errors;
6. inspect browser console errors;
7. validate affected flows.

Do not declare the task complete if tests fail.

---

# 32. Playwright

Use Playwright when available for UI validation.

Playwright may safely test:

- page loading;
- navigation;
- forms;
- modals;
- validation;
- buttons that do not send WhatsApp content;
- responsive behavior;
- statistics rendering;
- history rendering;
- empty/error/loading states.

Do not use Playwright to send real polls automatically.

---

# 33. Real WhatsApp Verification

Some WhatsApp integrations cannot be fully validated with mocks.

When a change affects sensitive WhatsApp integration code:

- run all safe automated checks;
- clearly identify what still requires manual verification;
- do not pretend mocked behavior proves real WhatsApp compatibility.

---

# 34. Error Handling

WhatsApp disconnections and API failures must not crash the entire EasyPoll server when they can be handled gracefully.

Preserve or improve handling for:

- authentication failures;
- disconnects;
- QR expiration;
- unavailable groups;
- unavailable contacts;
- history loading failures;
- profile picture failures;
- vote retrieval failures.

Partial failures should not unnecessarily invalidate unrelated data.

---

# 35. Logging

Logs should help diagnose technical behavior without leaking conversation content.

Safe examples:

```text
History scan started
Messages scanned: 500
Polls found: 10
Votes recovered: 82
History stabilized
```

Avoid logging:

- normal message bodies;
- full contact numbers unnecessarily;
- QR contents;
- auth data;
- session files;
- private conversation contents.

---

# 36. Dependencies

Do not add a dependency when the platform or existing stack can reasonably solve the problem.

Before adding a package:

1. verify whether it is necessary;
2. prefer maintained packages;
3. avoid large libraries for trivial functionality;
4. avoid overlapping libraries solving the same problem.

Do not replace existing libraries without an explicit reason.

---

# 37. No Unrequested Framework Migration

Do not introduce:

- NestJS;
- Next.js;
- Electron;
- another ORM;
- another backend framework;
- another database;
- another frontend framework;

unless the task explicitly asks for it.

Current planned direction:

```text
Backend:
Node.js + Express + TypeScript

Persistence:
SQLite + Drizzle

Frontend:
React + TypeScript + Vite
```

Follow the current migration phase.

---

# 38. UI Refactors Must Preserve Features

When the frontend is eventually migrated or redesigned, functionality takes priority over appearance.

Before removing an existing control, determine what behavior it provides.

Do not accidentally remove features such as:

- favorite groups;
- last selected group;
- group search;
- bulk option insertion;
- member selection;
- member profile pictures;
- history preparation;
- poll analysis;
- stats navigation;
- rankings.

---

# 39. Do Not Overengineer

EasyPoll should have clean boundaries, but avoid unnecessary enterprise architecture.

Prefer understandable code.

Do not introduce:

- unnecessary dependency injection containers;
- excessive generic repositories;
- event buses without a clear use case;
- microservices;
- distributed architecture;
- complex CQRS patterns.

This is a local application.

---

# 40. Before Starting a Task

An agent should:

1. read this `AGENTS.md`;
2. inspect `package.json`;
3. inspect relevant existing code;
4. inspect existing tests;
5. identify compatibility-sensitive code;
6. understand the requested scope;
7. make a short implementation plan.

Do not begin by immediately rewriting files.

---

# 41. During a Refactor

Keep changes scoped.

If unrelated problems are discovered:

- document them;
- do not fix them unless they block the requested task.

Avoid opportunistic rewrites.

---

# 42. Before Completing a Task

Verify:

```text
Does the requested feature work?
Did existing behavior remain intact?
Did tests pass?
Did type checking pass?
Did I introduce unnecessary dependencies?
Did I accidentally change WhatsApp behavior?
Did I persist anything that should remain temporary?
Did I expose sensitive data?
```

Only then consider the task complete.

---

# 43. When Unsure About WhatsApp Internals

If an existing piece of WhatsApp code looks strange:

**assume there may be a reason until proven otherwise.**

Inspect:

- Git history if available;
- comments;
- nearby helpers;
- installed library source;
- tests;
- runtime behavior.

Do not “clean it up” speculatively.

---

# 44. Priority Order

When trade-offs occur, use this priority:

```text
1. Preserve working WhatsApp behavior
2. Protect user privacy
3. Preserve user data
4. Maintain correctness
5. Maintain backward compatibility
6. Improve maintainability
7. Improve architecture
8. Improve aesthetics
```

A cleaner architecture is not an improvement if it breaks a working feature.

---

# 45. Definition of Done

A migration/refactor task is complete when:

- the requested scope was implemented;
- existing critical flows continue to work;
- automated tests pass;
- no real polls/messages were sent automatically;
- no normal WhatsApp conversations were persisted;
- no external storage or telemetry was introduced;
- compatibility workarounds were preserved unless explicitly and successfully replaced;
- new behavior is documented when necessary.

---

# EasyPoll Principle

EasyPoll should remain:

> **A local-first application for creating, importing, analyzing and visualizing WhatsApp polls — not a WhatsApp conversation archive.**

When making architectural decisions, preserve this principle.
