export const FeaturedStories = () => {
  return (
    <section className="w-full px-6 py-24">
      <div className="max-w-6xl mx-auto">
        <div className="text-center space-y-4 mb-16">
          <p className="text-xs tracking-[0.4em] text-primary/60 uppercase">
            Featured Stories
            </p>
            <h2 className="text-4xl md:text-5xl font-serif font-semibold text-white tracking-tight">
              Explore the collection
            </h2>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { theme: "Sci-Fi", emoji: "🚀" },
              { theme: "Crime", emoji: "🔍" },
              { theme: "Thriller", emoji: "⚡" },
              { theme: "Mystery", emoji: "🔮" },
              { theme: "Drama", emoji: "🎭" },
              { theme: "Adventure", emoji: "🗺️" },
              { theme: "Conspiracy", emoji: "🕵️" },
              { theme: "Suspense", emoji: "🎬" },
            ].map((story) => (
              <div
                key={story.theme}
                className="group relative aspect-[2/3] rounded-xl border border-white/10 bg-gradient-to-br from-zinc-900 to-zinc-950 overflow-hidden cursor-pointer hover:border-primary/50 transition-all"
              >
                <div className="absolute inset-0 flex flex-col items-center justify-center p-4">
                  <span className="text-4xl mb-4">{story.emoji}</span>
                  <span className="text-white/80 font-serif font-semibold text-center">
                    {story.theme}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
  )
};