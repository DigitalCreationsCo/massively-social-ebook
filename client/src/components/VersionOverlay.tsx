import pkg from "../../../package.json";

export function VersionOverlay() {
  return (
    <div className="fixed bottom-1 left-2 text-[10px] font-mono text-white/20 z-50 pointer-events-none">
      v{pkg.version}
    </div>
  );
}
