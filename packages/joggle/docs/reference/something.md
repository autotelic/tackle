# Conversation: Deterministic Harness for LLM-Assisted Development

**Date:** [unknown]
**Participants:** Speaker A, Speaker B
**Context:** Discussion about building deterministic guardrails around codebases for LLM-assisted development, productizing agency workflow into "Jig", and investment strategy.

---

**Speaker A:** It's good chocolate. Promotional preview from one of these companies here. Would they be in the morning seven to six dollars? I don't even know, actually. One of them is the agency working better right now for Jig, Shakti and Bright Web, like helping Bright Web up a little bit better. They weren't doing the stuff that they're doing better and being able to run because low-hanging reproducibility needs to exist. So that's one part of it. And so that's it. It's like really just putting in stuff to them primarily for me, and I think also for the private workflow. That's primarily putting it into itself to help the LLM do its job in the sort of like straightforward prompting way. Right?

**Speaker B:** So when you say deterministic and prompting, they're sort of like in tension with each other.

**Speaker A:** You wrap around your repo with a lot of things that say how the code should be, including stuff like assembly, various rules, really strict. Really strict modules, relationship rules, strict file length rules, and things like that — just lots and lots of checks in a way that you don't normally go, or we don't normally go that hard. Like we've got warnings, thousands of warnings alive, right? You do not have that. Like if it has warnings, it's failed.

**Speaker B:** Yes.

**Speaker A:** Right? Because what you want is you want as much as possible to control the code. So the more you have of that, and then also tests, and then also ideally like front-end tests as well, like functional tests — the more you wrap this around with things like that, the more any code that's produced by anyone has a smaller surface area for mistakes. There's less surface area in which it can do stupid things. And then it's easier to review, it's easier to make sure that it's doing the right thing, etc. And so the workflow there is you build these deterministic things, you do a larger end-to-end prompt where you're talking back and forth agents and they say, "right, yeah, go ahead implement that," or discuss it, go ahead and implement it. And then after it's implemented it, either you get it to run or you just run this battery of tests and if anything goes wrong you say, "I have to fix the shit," and then when that's all done then you can review it.

**Speaker B:** Now when you say wrap the repo, what does that look like?

**Speaker A:** In the same way that you have the repo and that's just the code, and in the same way that you might wrap that around with unit tests — like, "I want test coverage for all this thing." And you might have like an actual test coverage metric. So it's like that. It's just anything that sits in the repo but isn't the actual code — we can say harness around the code to make sure that it gets done in a certain way and that certain rules are followed. It's codifying the rules in as far as possible — codifying all the rules that you follow in the code base in something that is machine verifiable.

**Speaker B:** Right. So, a little bit the entropy machine.

**Speaker A:** But it's the entropy machine that prevents it upfront.

**Speaker B:** Why would it want to prevent it upfront? Why wouldn't CI have the sort of random walk — or rather run a lot the same way, say, like the type checker or linting would run, where as you're writing the code, you can do that random walk and then pre-commit hook, it's a CI, it's something like if you're doing it in the prompting, it's then it's pre-commits as well.

**Speaker A:** Should it be like — yes, the more you automate it, the better. Less aware of the...

**Speaker B:** Okay. So, like, what are the pieces that are missing today then? Like, there's like any numbers.

**Speaker A:** Sure, like I mean like all of them. So when it comes to something like a package of lint rules — here are the linting rules for generic project X versus here are the linting rules for this specific WordPress project. What does that look like?

**Speaker B:** So I'm hearing it's like a generic wrapper, but it also feels very project specific.

**Speaker A:** Yeah. And so you start at the level of the obvious generic test. But it's not that simple. And then you write specific rules within that. So you have your unit tests. The idea of generic unit tests is generic and it's not very complex. But the specificity of the unit tests is something you write tests for. And you go further and you would say we need to have this much test coverage. I've been working on something which is: what does genuinely useful 100% coverage look like? Because you don't necessarily need 100% coverage to actually know — because if you're covering... but maybe that's an architecture thing, maybe if you don't have 100% coverage, it's because something is architecturally wrong. Or do you only test the seam? So there's stuff like that.

But let's not get into that. You just have — that's one thing, is you have unit tests. Another thing is you have linting. You have a set of lint rules, and those are generic across TypeScript projects or PHP projects or WordPress projects. So there's a PHP standard, there's a WordPress add-on, and there are — you can choose different ones, but there's like a fairly consensus-accepted one, as there is for TypeScript, which is: this is how you should do it. You shouldn't do these things, you should do these things. That must have no warnings, it must pass — at the end of that, that's a test. And that's generic.

But then beyond that, you can have things which are specific to your project. So you might have — one of the things, the idea in my head is that you have to be... I've finished my three. I've done 300. I've done SASQ. You still need some animation and you want to make sure that I'm going to finish last year. This is the idea of only — this is the idea of trying to get review quicker. There's some things in this way, and that's all you can do. Anything else is a chain press. And so you lint for that. You can only use this module in this way. You must use the module, you must import it from here. You only have these slots. And it can only have these outputs, and it must be validated across those things. And if you change that, that's a change request.

**Speaker B:** I'm always happy to do.

**Speaker A:** Ideally, you try and find that up front, so I'm working on that as well. So, here are some of the other ideas. Okay, don't just do it in your head. You can write tests in Postgres.

**Speaker B:** I am happy to do that.

**Speaker A:** You can do check constraints, exclusion constraints, row level security. And then you can do PG Tap to ensure that that stuff's working. So you can write Postgres tests as well. And the reason you would bother doing this — so in a lot of cases, we're like, the more tests we have, the more stuff we have to change when they change stuff, right? But an LLM changes the thing on that. And the other thing that it changes is: you want to have belt and braces stuff to make sure that no one can fuck this up. Right? And so you have these layers, you just layer it strong. So then it becomes harder and harder to actually do anything wrong. Because you're not worried about their time, the LLM time of doing it again. You can just say it's wrong, do it again, it's wrong, do it again, it's wrong, do it again — until it passes everything. All the things pass.

**Speaker B:** So these aren't necessarily for you. This is for...

**Speaker A:** No, yeah, I understand. And then there's migration linting as well with Squawk. Query analysis in a test. So, like, is this IBS and Fernando's? So, some of these you would run in CI, like assert query counts, catch N+1 queries, there's all this stuff you can do. Like I went through a whole process with the LLM to really dig into what we can do. We can do all of this with a machine, right? Open API spec linting, breaking change detection with OAS diff. Property-based API testing with Schemathesis generates thousands of valid and edge case requests automatically.

**Speaker B:** This is like property test rock, love those.

**Speaker A:** Right, yeah. So we just put those and run those on CI and just like slamming stuff, right? And then we say, this is what it found. Clean, fix it. And you just make it stronger and stronger. Response shape consistency.

**Speaker B:** Yeah, it's not like bad enough where I'm like...

**Speaker A:** Dead code detection. License compliance, bundle size budgets, secret detection — it's old school, but no personal information. Environment variable validation. Lighthouse CI, query count budgets for endpoints using the profiler infrastructure that already exists in the chat team. Commit message enforcement. PR quality gates with Danger — automates PR review rules, risk engine, source files change without corresponding test changes.

**Speaker B:** Yeah, we're reinventing risk engine, right?

**Speaker A:** Yeah. That's a lot of stuff already, right? So you do this stuff and then another one is Semgrep. So you can do import discipline with ESLint. So you cannot — you must not import from here. You must import from here. That will actually catch some problems that I've seen LLMs do. Because they just — they're like objective: here's how we get in there. It's whatever the quickest slope is. That's the Hugging Face hack. You can Semgrep a lot of stuff for more specific architecture rules, like about UI modules — so rule HTML, ban safe, compositional correctness, enforcing with a linter the structure that you put in the UI. Styling discipline: Semgrep, Tailwind lint, saying no hard-coded colours, you can't do this, you must do this, like highlighting stuff for consistency across stuff.

Because the other thing that I want to do is: if you are — did we design this? You must, as far as possible, use the system UI patterns. If you are not, that needs to be a human in the loop.

**Speaker B:** Right.

**Speaker A:** We're introducing a new pattern, and that's a change request. That's an expansion of the scope of work. And you still get the LLM to do it, but then you go through with them and say, right, we need to change, we need to add this in this way. Pattern compliance for forms and error boundaries: Semgrep, and I think with TSMorph. Accessibility: you can do static analysis and runtime analysis. So there's Axe Core and Playwright. And then layout and style regression, you could do screenshots — Chromatic. So that's a big architecture. Unit testing for TypeScript. Dependency graph, file names and locations, file content, code metrics.

**Speaker B:** So assembling that package of rules, what does that look like for a given project? Because that's 20 tools with 20 configs.

**Speaker A:** I think that a bunch of it is generic. So — okay. At this level, you have the thing which is 100% generic. If it is a TypeScript project, you set these things up tomorrow. And right now, they are either empty or they are the consensus-agreed thing that every single TypeScript project we do will have. I think that first layer is set up and running. The second layer is consensus — don't be like, "oh, yeah, that's the only thing." A large percentage is consensus opinion stuff. So I think that a significant percentage of it is going to be the same stuff every time because you standardize on how you build these things and you have those rules. So you write the rules and then you put them on all of your TypeScript projects. And then new rules come, and then you do a process of — the LLM — if something isn't passing and there's a good reason it's not passing, there's a new manual... and so you have that process of refinement using the LLM.

**Speaker B:** So you're using LLMs to do all of this, actually.

**Speaker A:** Yeah, I know. And then for certain projects, there will be specific things — projects that are sort of Shakti-level things, where Shakti has essentially — there are some things about the way that the code needs to work that reflect business logic of Shakti in some way.

**Speaker B:** What's an example?

**Speaker A:** It might reflect how tenants relate to each other, which we wouldn't necessarily have the stuff about how tenants relate to each other in the board system, which isn't necessarily a universal Jig thing, say, because they've made different decisions. And so you would have that in some specific rules which say, "as of this understanding of it, this doesn't do this." And the reason — you would normally, for humans, you couldn't do that because the humans know that business logic and, when you're doing the testing, it will come. But you want that enshrined in something deterministic for you to choose. So, basically, if it can be enshrined in a deterministic test, it should be.

**Speaker B:** Yes.

**Speaker A:** And nothing is too detailed and nothing is redundant because it's for LLMs. We just make it so tight. Anything that can reduce the surface area. Or rather, it's like this is like a big compiler on top of everything, where it will throw compiler — "this project will not compile to the spec of an Autotelic project because you've misnamed a thing and because this file is in this relationship to this."

**Speaker B:** But I think just wrapping once with so many constraints... I want to think about how those constraints on project A inform the constraints on project B. So as we work on Jig, we realize: oh, this constraint is actually very helpful. How does this then cascade out to all other Jig projects? And so, how do we wrap that whole ecosystem — there's like 20 tools worth of configs. How does that stay consistent across project to project? That's where I see a lot of drift, and that's where I see a bit of lift, basically.

**Speaker A:** Yeah, how do you get 100%? So you make it easy to bring this into a project and have that... less interesting — with the BrightWork dev team, anything that I suggest they're like, "well, we need more time to do that, we need time." And I'm like, so maybe you could win the time by implementing some of this shit, right? And I don't want to over-engineer on any side of things — the shared framework, I don't immediately like, "we need a module that we can install that does blah blah blah." What we do is we put the most useful thing in place on Shakti that makes us faster at building correct code with an LLM. And then we do that again, and then we do that again. And if it's useful, we port it to Jig, or vice versa. Whichever one you're working on, you do something and then you port it. And then when we have that and we've determined the usefulness of it, we use the time that we've saved from using the LLM to then do some kind of abstraction that makes sense for the general purpose.

**Speaker B:** The general case, yeah.

**Speaker A:** But we don't over-engineer, we don't over-abstract right now, because what we are going to do is copy shit from other places. Like, we can point a slow action — slow overnight action — at it and say, "replicate this and give me a PR." You know? So I want to do some of that as well.

So I said I was talking about the three prongs. It was still only on prong one.

---

## Prong One: Agency

**Speaker A:** Prong one is that agency side. And one of the things I'm going to do is start to write about that in blog posts. Each time we do something we like, "here's our philosophy, here's the thing that we did." Just as a — these are short blog posts building up a body of evidence for sales. Having to do a sales page which is like, "this is what we're doing, would you like us to do it for you?" Payable for hire. That's one thing. That's the sort of like right now, spin it at moment. We are engineering your code base to make it easy to develop.

And the other thing I want to do is we haven't even touched on Playwright front-end tests. Or something like Minion for running it completely sandboxed. Maybe re-changing the architecture of things so that you can run it inside a very lightweight VM. And if it's taking too long, it's going to run overnight on CI, and then you get a PR back. But if it can be done in the background or done at the time, or you're going for coffee and press the button, then it should be done. So it should be available both those things.

And one of those things should be: we think we've done all the deterministic tests on the code base level, on the code level. Now I'm going to press this button. This isn't an LLM thing. This button will run a script that spins up a completely encapsulated environment with relevant seeds and then run a bunch of front-end tests against it to make sure that we haven't broken anything and to tell us what that actually looks like. It can take a bunch of — movie of the thing, like whatever.

Deploy it as an interactive page that you go and interact with. Deploy it as a push-button temporary full deployment on a Fly VM that pops up — one of those cold start jobs. If you want, you don't need videos and things like that. I did a proof of concept with my harmonic mixing thing of running — they have a thing on Fly with the fly config where you can run multiple Docker containers on a single Fly VM. The idea of it is for sidecars. That's all their docs — is for sidecars. And I was like, can I just use this to run Postgres, this and this at a very lightweight level? You 100% can. So then you have an all-in-one thing.

So your PR sets that up, it doesn't start it, and then you're like, "I want to review this now." You press a button that spins it up for you, it tells you when it's ready, and then you go in — maybe it even guides you. Maybe it has a thing down the side which says, "Do this, do this, do this, here's the specific check mark, check mark, check mark." Anyway, this is just all of these things. I have all these ideas about what's possible.

So this is thread one of agency stuff — making our day-to-day life better right now.

---

## Prong Two: Productizing into Jig

**Speaker A:** And then thread two is how do we productize that into Jig? All of that stuff — you can see how it helps with Jig. And then, as we get to the later stuff of being able to spin up a completely isolated environment with whatever checks around it, and then have the person — maybe it has sanitized their real production data, but sanitized and in there for some value of "in there" — so they can actually see what it looks like with their data. So they have this real thing of the thing that the LLM built. It's got all of these constraints, so it doesn't work. And then they can step through it and see if the feature actually does what they described when they had in their head when they put it in the ticket.

They can have a conversation with the agent that can see that thing — because we use that thing — the guy replaced Loom with something that LLMs can actually view. We do something like that so the LLM can actually see what they're seeing and they can have a conversation with it about the thing and be like, "oh, actually, it was more like this. Let's make this button bigger. Let's make this something, something. I thought it would be more blue."

**Speaker B:** Classic client stuff, but the LLM doesn't care, it's not going to get frustrated.

**Speaker A:** Brilliant. That's a good sales thing. I want it bigger and bluer. And then we'll say, great. We're going to explore that fuzzy space. We're going to have three options. Everything from that column leads into that column, but you wrap it in a different way so that it's working with a different interface for someone just describing stuff.

**Speaker B:** Who is this for?

**Speaker A:** It's for smart people who know their product and want stuff for the product, and they know how that's going to work. It's for Josh. It's for Aaron. It's for Thomas at BrightWork. It's for those people — the kind of people who are vibe coding stuff right now because they know what they want. But as I was trying to figure out — video from whatever space says "no vibes allowed." This is not vibe coding, this is within something else. And the thing of Jig is you're doing features within a framework that features human-verified, battle-tested code for things like payments and subscriptions. So you can only add stuff within that context. You can add other stuff, but when you try and go beyond, it gets harder to do, or the constraints get more. It's like, "okay, I will need a human to look at this." And that's part of your subscription. And so that's the idea of the Jig product — try and get to that point.

---

## Prong Three: Investment

**Speaker A:** And then the third pillar is seeking investment. It's like writing stuff — what is the USP, what is the total addressable market, all of that stuff, putting together a... Because the best one for that, which gets the next traction, was just like the one downtown, simple as downtown.

---

**Speaker B:** Building those guardrails, those patterns — you have this big list of things? You wanna shoot it over to me? You had this enormous list of deterministic — existing deterministic tools.

**Speaker A:** Yeah. It's all LLM-created. So I mean, I've talked it through and read it and like been active in getting it done and like prompting it with questions, but it's all written by the LLM, just to warn you.

**Speaker B:** I mean, like, that event might be fine, but I have a bar, but I wasn't like this.

**Speaker A:** So, this weekend, part of what I was working on was — if you go to Autotelic on GitHub, you can see we've got a fork of the Composition starter pack and there's a branch off of that called Mess. And basically, took that idea of that starter pack and said, okay, there's other things we do that we work in and on, and that should have patterns, opinionated patterns that we use in other places. Here's how we build a Fastify thing. Here's how we build... Here's how we connect data sources.

**Speaker B:** It's like the reverse thing, right?

**Speaker A:** Which reverse thing? You carry on and then I'll interrupt.

**Speaker B:** So the idea was — the things that I was working on this weekend was... I'll try to find it. Was it DM? Did you DM? I don't know if I did. I think I maybe just...

**Speaker A:** You sent it to me, but I don't know what it...

**Speaker B:** Yeah, I heard something about it. Mess entropy machine. So there's two things. There's that — the actual entropy machine itself. And then separately, I love this idea — your LLM chart on it.

**Speaker A:** Oh, yeah, definitely that has — this is exactly the stuff I'm talking about. It's like, but even further — like box deterministic for the LLM for the bits that should be LLMs to like help you bring that code base to where it needs to be.

**Speaker B:** Okay, actually, it's here. It's Jig Stack Patterns. That I put it in its own repo. Didn't realize I did that. On Autotelic.

**Speaker A:** On Autotelic. Here, I'm just gonna...

**Speaker B:** Love it. Good.

**Speaker A:** And there's a branch called Effect as well. And that has a lot more in it. And you can see — well, I mean, a bunch of it is the LLM. But basically, the component pattern starter, which is sort of that existing thing — it's like, okay, I'll really enjoy, or I really like working in the ergonomics of this particular pattern. And how do you get the LLM to write... This is all LLM-written, right? How do you get the LLM to write stuff like this instead of LLM style?

**Speaker B:** What do you mean? This is so much better than my LLM style. But like which part specifically, like the README?

**Speaker A:** The README is very straightforward. It's what I want to get to.

**Speaker B:** I get that and I try and tell the LLM and I'm constantly saying it's still got em dashes. I really go at em dashes.

**Speaker A:** I mean, some of it is model choice, some of it is like here's an existing document — call it this document — and it's Alchemy cracking starter.

**Speaker B:** What's Alchemy?

**Speaker A:** That's like a way to build your deployment config. And so the full stack example is like: here's all of the stuff, here's all of these patterns in one tiny toy of a thing. And then the other half of this is that entropy machine, which is pointed at this full stack example and says like, what is and isn't throwing errors? And is it that my example here, my full stack example, is not implementing these patterns that I have in all of these sibling repositories, or sibling folders to the full-stack example? Or does the entropy machine need to implement some new pattern?

So ideally, what I'd like to have is the entropy machine — you point it at Jig Stack Patterns and it says, "thumbs up, screen. We're happy. This bundle of patterns is 100% conformant to the entropy machine, or rather to the patterns." And the entropy machine is how you validate all of these patterns. And then similarly, I imagine, in this example, we're adding all of those other linter rules and like this stack of tools. And then the thing that I'm thinking about is: how is it easy to then point this at a new repository? Can I just point this as-is at Jig and like just start working?

**Speaker B:** Yeah, exactly, right? Like there's here's a list of compiler errors for this full wrap of stuff. Yeah, and just get to work on those. And so a lot of what's in that first pillar that you're talking about, is I think this, and then also some of the other stuff that I hadn't thought about, like the Postgres. How do you decide what the right architecture for a Postgres set of tables is? It's like — that's fun.

**Speaker A:** Yeah. And that — you can — there's going to be bits of this that you can do, which is like heuristics leading to a human loop for stuff. And so if you and I — or we could do it together — if you and we have a database schema, a Postgres database schema, there are going to be things that are rules-based things that are code-smelly stuff. Like, there's really obvious ones like pluralized table names. There's going to be other ones like: is this over-normalized, or is this whatever? I just feel like this is a thing, right? And you can have a set of heuristics that you give to an LLM to do that, and then the LLM says, "maybe these things, what do you think?"

**Speaker B:** I hear that, but I also think, like, the more I think about it, those sort of non-deterministic pieces, those LLM things — I want them not to assess stuff. I want the non-deterministic stuff to be like pure creation and then every assessment is deterministic, and that those weird gray parts is like us deciding: "no, this is the correct architecture." There's only one correct — like, if there's a plural table name, that is just a mistake.

**Speaker A:** But there must be grey areas where you can use an LLM to highlight potential grey areas. It's not assessing so much as it is highlighting where things could be a problem for you to then go and focus on.

**Speaker B:** Sure, but also its assessment should feed into something like the entropy machine, where it's like, "this is a new rule" — this is like an actual architectural convention that we...

**Speaker A:** You have a feedback loop.

**Speaker B:** 100%.

**Speaker A:** Yeah. Anyway, I think we're talking on the same thing. This is like the fuzzy stuff at the edges, right? There's a whole bundle of stuff which is like — so the way I see this is when you're starting something you've got the stack patterns. When you're starting greenfield, you've got the stack patterns, and then you put in all the harness stuff. And when you're going brownfield, you put in all the harness stuff and then start fixing the compiler errors. So you use the entropy machine to start tightening the code base. And you keep doing that, and maybe you make some of the stuff warnings because it's a real piece of software that's running and you can't change everything at once. And so some of the stuff is like warning — you have different levels of settings. Each level of setting really should be like a dependency tree: you must fix this first, you must fix this second, rather than like "only fix the criticals." It's like in order to clean the tree, you need to do the leaves first and then the next leaves and then the next leaves.

In a real world project, you might not have time for all of that, right? We still gotta keep running.

**Speaker B:** The robots. The robots do it in that order, but then the humans make decisions about what level of stuff are they prepared to still accept, because it's obviously still running — it's running in that state.

**Speaker A:** Yeah, to keep it running in that state whilst you gradually tighten the ratchet into perfect code. It's the shrimp. It's the automated shrimp. It's like I want to start doing this stuff against real project stuff. I mean, Shakti is the one — Shakti would be a good thing to do it for.

**Speaker B:** Excellent.

**Speaker A:** In a way that is ours for Jig rather than theirs, you know? Like they can have it, but because we're developing it in their time...

**Speaker B:** So what does that look like?

**Speaker A:** It just looks like anything we do for them to try it out which helps them should be replicable in Jig because they're very similar code bases. So we'll do all the stuff that matches between them and that we can, and so whatever comes out of there should then be...

**Speaker B:** I think I've got a fork of Forest Builder. So we could even do it like that. We could have the robots just do all of Forest Builder — what does that look like?

**Speaker A:** Yeah. Interesting. Well, just be like, "I added this to Forest Builder." And I've synced it now. I've synced the fork. We have a private fork for Forest Builder. We've synced it ethics. For the Forest Builder, we've synced it.

**Speaker B:** And then you have the Jig bots look at Forest Builder thing and say, "give me a PR to implement this thing in Jig."

**Speaker A:** I see, I see, I see.

**Speaker B:** I'll do the reverse. So I'll do stuff in Jig. And then we'll do that stuff into our fork of Forest Builder — interesting — and then take that across into Forest Builder.

**Speaker A:** Yeah, that's how we do it. So both of them live on Autotelic and one of them is a fork that then feeds into the Shakti team. And one of them is a fork that's the same thing.

**Speaker B:** Yeah, the connecting is the fork of Forest Builder. And that's a two-way connector. Jig stuff goes into it, and then when you take Jig stuff into it, and the bots from Jig take the Forest Builder stuff out of it.

**Speaker A:** Down. I like that.

---

## Tooling & Implementation

**Speaker B:** I mean, the setup — Obsidian has this thing called Publish. I'll just pay the $10 for this month and we'll see how it goes. Where I can just publish my Obsidian pages so you can look at them. And you can also then work on them. So that I can share some of that to Tony Instinct stuff and then we can talk about it.

**Speaker A:** Yeah. And I have a whole bunch of other stuff for PHP as well. So I basically said, "look, my deterministic harness' fault" and give me the best practice PHP stuff. Now, in going through some of that before, I've actually started the process of going through that and turning it from me into tickets. I was interrogating it. And they have basically various specific restrictions, which are — some of which are human business restrictions about using certain teams. And so, in the context of working within that, I discovered that there was some stuff in there that wasn't strictly true. It was like sort of true, but not like strictly true, and it's just an LLM-ing stuff on the internet, so everything has to be like properly checked, obviously. So that's when the tires meet the road. You have to actually check that everything really exists. But these are ideas — these are basically ideas, and 80% of it is links to real things that will work, or 90% — maybe 90%. 10% of it is linked to something that's a nice idea that doesn't exist yet.

**Speaker B:** Right. And someone explained it.

**Speaker A:** Okay. Right? It's a really good source of the concepts of like what to do. You could like — everything we just talked about is a real thing that in theory could be done. How hard is it to do? I think that one of the things I would like to do is to create some new things along the way. See how excited I get now.

---

## Resonant Computing

**Speaker B:** I do. So I have another thing. I linked this already. I don't know if you already... This is Resonant Computing. It's obviously related to the Agile Manifesto, and it's like a response to all of the horrors of big tech and LLM nonsense. "Technology should bring out the best in humanity, not the worst." This is a manifesto for Resonant Computing, which is a pattern language — person reference Christopher Alexander — built on five principles that reject hype and scale instruction for human flourishing.

**Speaker A:** I love it. I absolutely love it.

**Speaker B:** And within — okay, so Christopher Alexander spent his career exploring — my son built a brand and said in the deadness. This is — I love pattern language. I have the work in Python, so if I go there, which all tries to specify it to you, if I can find it, make some assignment. I like the little addendum at the start, which is like: if all you can do is read the titles of each of the sections, the headers of each of the sections — that's enough.

**Speaker A:** Yeah.

**Speaker B:** So, five principles are:

- **Primacy** — People must serve as primary stewards with their own context.
- **Dedicated** — It should work for you, ensuring contextual integrity, where data must align with your expectations. Must be able to trust — there are no hidden agendas of competing interests.
- **Plural** — No single entity should control the digital spaces. Distributed power, interoperability.
- **Adaptable** — Software should be open-ended and pro-social, which enable connection and coordination.

**Speaker A:** I love this. So you love this when you sign it.

**Speaker B:** And then it's explore and contribute. Oh, that's actually in Word — Google Doc. But there's another thing which is the Lab. And the Lab is an R&D lab, right? To take theses into principles into an R&D lab and your work — he says what? You can propose a garden, a project or a gathering. I'm not ready for a gathering yet. But I'm doing work for this Forest City thing.

**Speaker A:** Yeah, Forest City.

**Speaker B:** It's actually building a little bit of momentum. And some of the stuff — sort of the gardens — is groups of three to ten people who gather around a single question and tend it over a season until something real grows: a framework, a paper, a working prototype. First are taking root now — among them: portable memory, new EQ-based evaluation frameworks, or paying by models. "If a question has been tugging at you, maybe you're in a garden." I want to try and get something that comes out to be either the work from Forest City or this work or both that could be a garden.

**Speaker A:** It could be a garden. Yeah? That's a good goal. Don't know what it is yet. We will find out. That's what I want to do. Because I want to do a thing that I'm... This resonant computing really, really vibes, really, really resonates because I've got this thing in my head about ethical LLM usage. I really like the vegan LLM thing, I really like the open weights models and open code, and I don't know if I sent that annual dash thing...

**Speaker B:** Oh, he's CEO of Full Creek Software now, is he? What? What? How do I get to your rook? What's your rook then? Oh, there you go. Just scroll down. "How we will fight the platform war against AI." You win platform strategy battles through power and persuasion. Get in front of it. Push for all AI usage to...
