export const SocialFeatures = () => {
  return (
    <section className="w-full px-3 py-6">
      <div className="max-w-content mx-auto">
        <div className="text-center space-y-2 mb-4">
          <p className="text-xs tracking-[0.4em] text-primary/60 uppercase">
            Community
          </p>
          <h2 className="text-4xl md:text-5xl font-serif font-semibold text-white tracking-tight">
            Social Features
          </h2>
          <p className="text-white/50 max-w-2xl mx-auto font-sans text-lg">
            The watch experience includes community features designed
            to enhance story engagement.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-2">
          {[
            {
              title: "Watch Notes",
              description:
                "Leave notes attached to specific moments in the story. React to other viewers' notes.",
              status: "LIVE" as const,
            },
            {
              title: "Episode Discussions",
              description:
                "Join the discussion room after finishing each episode. Share theories, favorite moments, and reactions with fellow viewers in real-time.",
              status: "LIVE" as const,
            },
            {
              title: "Reading Progress",
              description:
                "Track your progress through each episode with automatic block advancement. Tap to continue or wait for the next block.",
              status: "LIVE" as const,
            },
          ].map((feature) => (
            <div
              key={feature.title}
              className="p-3 rounded-md border border-white/10 bg-black/40 backdrop-blur-sm space-y-2"
            >
              <div className="flex items-center gap-2">
                <span className="px-2 py-1 text-xs font-mono bg-green-500/20 text-green-400 rounded">
                  {feature.status}
                </span>
              </div>
              <h3 className="text-xl font-serif font-semibold text-white">
                {feature.title}
              </h3>
              <p className="text-white/60 font-sans leading-relaxed">
                {feature.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};
