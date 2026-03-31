/**
 * Normalizes a value from a specific range to the engine-required 0.0 - 1.0 range.
 */
export function normalizeScore(value: number, min: number, max: number): number {
    if (max === min) return 0;
    const normalized = (value - min) / (max - min);
    return Math.max(0, Math.min(1, normalized));
}

/**
 * Runtime validation for the NarrativeProvider.
 * Ensures the passed object has the required functional 'shape'.
 */
export function validateProviderShape(provider: any): boolean {
    const requiredMethods = [
        "getLoreAtoms",
        "getNotableEvents",
        "getBlocksByIndices",
        "getHybridSearchCandidates",
        "getBlockCount",
    ];

    const missing = requiredMethods.filter(
        (method) => typeof provider[ method ] !== "function"
    );

    if (missing.length > 0) {
        console.error(
            `[NarrativeEngine] Invalid Provider: Missing methods [${missing.join(", ")}]`
        );
        return false;
    }

    return true;
}