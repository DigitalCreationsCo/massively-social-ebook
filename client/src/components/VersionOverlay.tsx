import pkg from "../../../package.json";

/**
 * Root Cause Analysis: Versioning failures usually occur when build arguments 
 * are not correctly passed through the Docker-to-Vite pipeline.
 * This component handles that by prioritizing the injected tag.
 */
export function VersionOverlay() {
  const isProductionEnvironment = import.meta.env.PROD;
  const buildTagFromInjectedEnv = import.meta.env.VITE_APP_BUILD_TAG;

  // Use the injected tag only if it exists and we are in prod; 
  // otherwise, default to a descriptive local dev string.
  const finalDisplayVersion = (isProductionEnvironment && buildTagFromInjectedEnv)
    ? buildTagFromInjectedEnv
    : `${pkg.version}-dev.local`;

  return (
    <div className="relative">
      <span
      data-testid="version-overlay"
        className="absolute bottom-0 w-full text-center text-[10px] font-mono text-white/20 z-50 pointer-events-none select-none">
      { finalDisplayVersion }
      </span>
    </div>
  );
}