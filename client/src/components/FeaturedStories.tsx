export const FeaturedStories = () => {
  return (
    <section className="w-full px-3 py-6">
      <div className="max-w-content mx-auto">
        <div className="text-center space-y-2 mb-4">
          <p className="text-xs tracking-[0.4em] text-primary/60 uppercase">
            Featured Stories
            </p>
            <h2 className="text-4xl md:text-5xl font-serif font-semibold text-white tracking-tight">
              Explore the collection
            </h2>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
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
                <div className="absolute inset-0 flex flex-col items-center justify-center p-2">
                  <span className="text-2xl mb-2">{story.emoji}</span>
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