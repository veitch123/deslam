# DeSlammatory prepared rewrites: work in progress

Not part of the website. This branch is where two machines hand work to each other every hour (docs/ANSWERS.md in the private repository):

- **queue.json**: written by James's Mac mini at five past each hour. Headlines from news sites' public front pages and feeds that DeSlammatory would rewrite and that nobody has answered yet.
- **rewrites.json**: written by a scheduled Claude cloud session (Claude Haiku) at twenty past each hour, following **instructions.md** (DeSlammatory's house voice).

The Mac mini then checks every rewrite the way a reader's page would, signs the ones that pass and publishes them on the `answers` branch. Nothing here is read by readers' devices.
