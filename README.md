# Benchcraft

Benchcraft is a tool that enables high-friction, productive science.

I had a lot of conversations recently about building with autonomy in mind, specifically regarding the balance between judgement and reckoning, especially how judgement is something that we have to establish for ourselves outside of algorithms (akin to taste). Meanwhile, reckoning can be easily duplicated by AI in rote tasks. The ultimate goal of LLMs is to help augment our human abilities, not replace them and weaken our capacities; thus, Benchcraft is a tool that enables scientists to form their view first, then entertain alternative arguments (from LLMs, alternative literature, peers, etc.)

This repo is for the public and researchers, also myself down the line.

## Running it

```bash
export ANTHROPIC_API_KEY=sk-ant-...
./run.sh
```

```bash
./.venv/bin/python seed.py
```

```bash
brew install ffmpeg
./.venv/bin/pip install -r requirements-voice.txt
```

## The first five minutes

I am hoping that within the The first 5 minutes of someone using this tool: they're able to write notes on some of the scientific experiments they're running, come up with some judgments about their initial results, and then ultimately, hopefully, be able to connect them to Zotero-type-organized readings or articles that they've done for previous research. I'm hoping that ultimately someone will be able to first make their own interpretation, but then further augment it with other resources and tools available to them.

## What I want to be told I'm wrong about

I'm hoping people can tell me about aspects of BenchCraft that frankly don't work. I don't want to be building something that other people don't use, so I want to make sure that every tool or feature is necessary. I just want it to be something that makes people better scientists and hopefully makes me a better one too.

## What this isn't

This will go through many iterations, but this is not an end-all replacement for every single scientific tool you're going to use. Rather, I'm hoping that this is kind of a good hub or home for scientists as they develop their own skills.

## Voice memos and connectors

I personally do a lot of work in voice memos. I think it's easier to sometimes voice-to-text transcribe. Speaking with a lot of fellow scientist friends, they mention a lot of times they're wearing gloves, so typing is not really fun. That was my goal for including voice memos and making sure that we have secure storage of transcripts, especially that Benchcraft itself will never summarize a voice note.

I think that's potentially a future consideration I can do. This matters to me because privacy and security are utmost. I think the IP is especially very important to science. If you want to further augment it with other agents, then you can bring in connectors and different things like that, but it is never folded directly into the thing I'm going to be building.

## Licence

MIT.
