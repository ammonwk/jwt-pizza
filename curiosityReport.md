# Curiosity report: Truffles, autonomous bug detection from session recordings

## Why I built this

Session recording tools like PostHog generate thousands of replays. Teams record everything but review almost nothing. I've seen this at work: bugs sit in plain sight inside recordings that nobody watches. The data exists, the human bandwidth doesn't.

I wanted to know what happens if you point an LLM at every session recording and let it find the bugs. And then, what if a coding agent could just _fix_ them and open a PR? That's Truffles. It takes PostHog session recordings in and produces GitHub pull requests out, with no human in the loop until review.

## How it works

The pipeline has five stages.

### 1. Session ingestion

Truffles syncs session recordings from PostHog's API. Each session comes as a bundle of [rrweb](https://github.com/rrweb-io/rrweb) events, which is a JSON-based format that captures DOM mutations, mouse movements, scrolls, clicks, console logs, and network requests. Truffles stores these alongside PostHog metadata (duration, user info, active time) in MongoDB.

### 2. Video rendering

This was the hardest part of the whole project. rrweb events aren't video. They're a log of everything that happened to the DOM. To get something an LLM can actually look at, I needed to replay those events visually and capture frames.

The rendering pipeline:

1. Spin up a headless Chromium instance via Playwright
2. Load the rrweb player in the browser
3. Inject the session's event data
4. Play back at 4x speed while capturing screenshots
5. Pipe the frames through ffmpeg to produce an MP4
6. Upload to S3

This sounds straightforward, but browser lifecycle management, memory limits, timeline compression artifacts, and timeout enforcement all made it way more work than I expected. Sessions can be 30+ minutes long, so the renderer has to handle long-running captures without leaking memory or hanging.

### 3. Dual-model vision analysis

The rendered video gets analyzed by two vision models running through OpenRouter: Kimi K2.5 and Gemini 3 Pro. Both score well on multimodal benchmarks, and I honestly couldn't decide which was better, so I kept both. Every video gets analyzed by both models independently.

A separate text-based analysis pass (Claude Opus) reviews the session's console errors and network failures, since some bugs don't show up visually.

Results from all three analyses are deduplicated against recently detected issues and run through a screening model that checks against learned suppression rules. Without this filtering, the system flags the same cosmetic issue across dozens of sessions, which makes the whole thing useless pretty fast.

### 4. Issue triage

Verified issues are stored with severity levels, the model's reasoning about what it found and why it matters, and links back to the source session. The web UI shows these for review, but the system can also proceed automatically to the next stage.

### 5. Agent execution and PR creation

For each verified issue, Truffles spawns a Claude Code agent using the [Claude Code SDK](https://docs.anthropic.com/en/docs/claude-code/sdk). Each agent gets:

- An isolated git worktree (so multiple agents can work concurrently without stepping on each other)
- The issue description, model reasoning, and session context
- An explicit instruction: "If you cannot find code related to this issue, report a false alarm instead of making speculative changes."

That last point matters a lot. Without an escape hatch, coding agents will make speculative changes to justify their existence. The false alarm system automatically builds a suppression list that the screening model checks on future runs, so the pipeline gets smarter over time.

Agents that find and fix the bug create a branch (`truffles/fix-<issue-id>`), push it, and open a PR on the target repo. The PR description links back to the original session recording and issue. After that, a human just has to review and merge.

## Architecture

```
PostHog Cloud (rrweb events, metadata, console logs)
        |
        v
Truffles API (Express + WebSocket, single process)
  ProcessingManager  →  render rrweb to MP4 via Playwright + ffmpeg
  AnalysisManager    →  dual-model vision + session data analysis
  AgentManager       →  Claude Code SDK → worktree → code → PR
        |
   ┌────┼────────────┐
   v    v            v
MongoDB  AWS S3    GitHub
         (videos)  (PRs on target repo)
        |
        v
Truffles Web (React + WebSocket)
  real-time agent streaming, issue review, PR dashboard
```

It's a Turborepo monorepo: React frontend with Vite/Tailwind, Express backend, shared TypeScript types, and Mongoose models in separate packages. Everything runs in a single API process, including the agent runner. WebSocket streaming lets you watch agents work in real time, which is honestly the most fun part of the whole thing.

## Connection to DevOps

This project connects to a few topics from CS 329.

On the automated QA side, Truffles replaces manual session review with LLM-powered analysis. It watches every recording, not just the ones someone happens to click on. Traditional automated testing checks code paths; this checks what users actually see and experience.

It also fits into the CI/CD picture, just with a weird trigger. Instead of a code push kicking off a pipeline, it's a user hitting a bug. The agents create branches, write fixes, and open PRs with full context about what happened in the session.

There's an observability angle too. PostHog session data (console errors, network failures, DOM events) feeds into a structured analysis pipeline. It's basically treating user sessions as telemetry instead of something you dig through when a support ticket comes in.

And the false alarm suppression system is really just alert fatigue management, the same problem you'd deal with in production monitoring. When noise goes unchecked, people stop trusting the system. Truffles learns from its mistakes the same way you'd tune PagerDuty rules.

## What I learned

rrweb video rendering is surprisingly hard. I expected the "replay events and capture frames" part to be a weekend task. It was not. Browser lifecycle management, memory pressure on long sessions, and getting ffmpeg encoding right took several iterations. I spent more time on this than on the actual AI parts.

The LLM orchestration ended up being where most of the real engineering went. Individual API calls are simple. Chaining them into a reliable pipeline with deduplication, screening, false alarm detection, and agent handoffs means you need clear contracts and failure modes at every stage. The orchestration code is more complex than any individual model call.

Agents need escape hatches. Without an explicit "false alarm" option, coding agents make speculative changes to justify their existence. Once I gave them permission to say "this isn't a real bug," the quality of the remaining fixes went way up. Giving agents a "dev feedback" field where they can flag problems with the issue description also helps you debug the pipeline itself.

WebSocket streaming changes how the whole thing feels. Watching an agent read files, reason about a bug, and write a fix in real time is a completely different experience from waiting for a result. It also makes debugging the agents themselves much faster, because you can kill a runaway agent before it goes too far off the rails.

Worktree isolation turned out to be non-negotiable. Running multiple coding agents concurrently requires complete filesystem isolation. Git worktrees solved this well: each agent gets its own checkout on its own branch, with automatic cleanup of orphaned worktrees.

## Tech stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Frontend | React, Vite, Tailwind, React Router | Dashboard with dark mode, WebSocket streaming |
| Backend | Express, TypeScript | REST API, WebSocket, agent lifecycle management |
| Database | MongoDB, Mongoose | Sessions, issues, agent history, settings |
| Video | Playwright, ffmpeg | rrweb replay in headless Chromium, MP4 encoding |
| Vision models | Kimi K2.5, Gemini 3 Pro (OpenRouter) | Multimodal video frame analysis |
| Reasoning | Claude Opus 4.6 (OpenRouter) | Screening, deduplication, session data analysis |
| Code agents | Claude Code SDK (Anthropic) | Agentic coding with tool use, isolated worktrees |
| Storage | AWS S3 | Video files, extracted frames, thumbnails |
| Version control | GitHub API | PR creation, branch management on target repo |
| Monorepo | Turborepo | Shared types, parallel builds |

## Conclusion

Truffles started as a question: can LLMs watch session recordings and find bugs that humans miss? It turned into a full pipeline from bug detection to pull request. The hardest problems weren't the AI parts. They were the plumbing, like video rendering, pipeline orchestration, and making agents fail gracefully. If I had to pick one takeaway, it's that giving AI agents the option to say "I don't know" produces way better results than forcing them to always produce output.
