import { useEffect, useState, useCallback } from 'react';
import {
  Activity, Settings2, GitMerge, FileText,
  Play, AlertCircle, CheckCircle2, FlaskConical,
  Info, History, Target, Trash2, Lock
} from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// --- Utility ---
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// --- Interfaces ---
interface LabConfig {
  saliencyThreshold: number;
  weightDense: number;
  significanceCoef: number;
  temporalPhrasing: boolean;
}

interface ScoredCandidate {
  id: string | number;
  score: number;
  isNotable?: boolean;
}

interface TracePhase {
  harvest?: {
    totalBlockCount: number;
    loreCount: number;
    candidatesCount: number;
  };
  fusion?: ScoredCandidate[];
  saliency?: (string | number)[];
  timeline?: (string | number)[];
}

interface TraceObject {
  timestamp: string;
  channelId: string;
  inputQuery: string;
  phases: TracePhase;
  discardedCandidates?: ScoredCandidate[];
  finalizedPrompt?: string;
  error?: string;
  labConfig?: LabConfig;
}

// --- Sub-Components ---

const SaliencyIndicator = ({ score, threshold }: { score: number, threshold: number; }) => {
  const isSurvivor = score >= threshold;
  return (
    <div className="flex items-center gap-3 w-full">
      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden flex">
        <div
          className={ cn(
            "h-full transition-all duration-500",
            isSurvivor ? "bg-primary" : "bg-muted-foreground/30"
          ) }
          style={ { width: `${score * 100}%` } }
        />
      </div>
      <span className={ cn(
        "text-[10px] font-mono w-8 text-right",
        isSurvivor ? "text-primary font-bold" : "text-muted-foreground"
      ) }>
        { score.toFixed(2) }
      </span>
    </div>
  );
};

// --- Main Application ---

function App() {
  // Auth State
  const [ token, setToken ] = useState<string | null>(sessionStorage.getItem('lab-token'));

  // Lab State
  const [ traces, setTraces ] = useState<TraceObject[]>([]);
  const [ selectedTrace, setSelectedTrace ] = useState<TraceObject | null>(null);
  const [ inputQuery, setInputQuery ] = useState("");
  const [ generating, setGenerating ] = useState(false);
  const [ lastGenerationResult, setLastGenerationResult ] = useState<{ error?: string; context?: string; } | null>(null);

  // Config State (Synced with Engine defaults)
  const [ saliencyThreshold, setSaliencyThreshold ] = useState(0.65);
  const [ weightDense, setWeightDense ] = useState(0.7);
  const [ significanceCoef, setSignificanceCoef ] = useState(1.5);
  const [ temporalPhrasing, setTemporalPhrasing ] = useState(true);

  const API_BASE = "http://localhost:5002/__narrative_lab";

  const labFetch = useCallback(async (endpoint: string, options: RequestInit = {}) => {
    let currentToken = token;

    if (!currentToken) {
      currentToken = prompt("Enter Narrative Lab Token (see CLI output):");
      if (currentToken) {
        setToken(currentToken);
        sessionStorage.setItem('lab-token', currentToken);
      } else {
        throw new Error("Token required to access Lab.");
      }
    }

    const res = await fetch(`${API_BASE}${endpoint}`, {
      ...options,
      headers: {
        ...options.headers,
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentToken}`
      }
    });

    if (res.status === 401) {
      sessionStorage.removeItem('lab-token');
      setToken(null);
      throw new Error("Session expired or invalid token.");
    }

    return res.json();
  }, [ token ]);

  const fetchTraces = useCallback(async () => {
    try {
      const data = await labFetch('/traces');
      const sorted = (data.traces || []).reverse();
      setTraces(sorted);
      if (sorted.length > 0 && !selectedTrace) setSelectedTrace(sorted[ 0 ]);
    } catch (err) {
      console.error("Fetch failed:", err);
    }
  }, [ labFetch, selectedTrace ]);

  const handleGenerate = async () => {
    if (!inputQuery.trim()) return;
    setGenerating(true);
    setLastGenerationResult(null);

    try {
      const data = await labFetch('/generate', {
        method: 'POST',
        body: JSON.stringify({
          channelId: "cinematic-canvas-lab",
          query: inputQuery,
          config: {
            saliencyThreshold,
            weightDense,
            significanceCoef,
            temporalPhrasing
          }
        })
      });

      if (data.error) throw new Error(data.error);

      setLastGenerationResult({ context: data.context });
      await fetchTraces();
    } catch (err: any) {
      setLastGenerationResult({ error: err.message });
    } finally {
      setGenerating(false);
    }
  };

  const clearTraces = async () => {
    if (!confirm("Delete all historical traces from the narrative ledger?")) return;
    try {
      await labFetch('/traces', { method: 'DELETE' });
      setTraces([]);
      setSelectedTrace(null);
    } catch (err) {
      alert("Failed to clear ledger.");
    }
  };

  useEffect(() => {
    if (token) fetchTraces();
  }, [ token, fetchTraces ]);

  return (
    <div className="min-h-screen bg-background text-foreground font-sans selection:bg-primary/30">
      {/* Header */ }
      <header className="h-16 border-b border-border flex items-center justify-between px-8 bg-card/50 backdrop-blur-md sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center shadow-lg shadow-primary/20">
            <FlaskConical className="w-5 h-5 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-sm font-bold tracking-tighter uppercase">Narrative Engine Lab</h1>
            <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-widest opacity-70">v0.0.1</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 px-3 py-1.5 bg-muted/50 rounded-full border border-border">
            <Lock className="w-3 h-3 text-primary" />
            <span className="text-[10px] font-mono text-muted-foreground">
              { token ? `TOKEN_ACTIVE` : "AUTH_REQUIRED" }
            </span>
          </div>
        </div>
      </header>

      <div className="grid grid-cols-12 h-[calc(100-4rem)] overflow-hidden">
        {/* Left Sidebar: Ledger */ }
        <aside className="col-span-3 border-r border-border bg-card/30 flex flex-col">
          <div className="p-4 border-b border-border flex justify-between items-center">
            <h3 className="text-[11px] font-bold uppercase tracking-widest flex items-center gap-2">
              <History className="w-4 h-4 text-primary" /> Narrative Ledger
            </h3>
            <button
              onClick={ clearTraces }
              className="p-1.5 hover:bg-destructive/10 text-muted-foreground hover:text-destructive rounded-md transition-colors"
              title="Clear Ledger"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            { traces.map((t, i) => (
              <button
                key={ i }
                onClick={ () => setSelectedTrace(t) }
                className={ cn(
                  "w-full text-left p-3 rounded-xl border transition-all duration-200 group",
                  selectedTrace === t
                    ? "bg-primary/10 border-primary/30 shadow-sm"
                    : "hover:bg-muted/50 border-transparent text-muted-foreground"
                ) }
              >
                <div className="flex justify-between items-start mb-1">
                  <span className="text-[10px] font-mono opacity-50">
                    { new Date(t.timestamp).toLocaleTimeString() }
                  </span>
                  { t.error && <AlertCircle className="w-3 h-3 text-destructive" /> }
                </div>
                <p className="text-xs font-medium line-clamp-1 group-hover:text-foreground">
                  { t.inputQuery || "Empty Simulation" }
                </p>
              </button>
            )) }
          </div>
        </aside>

        {/* Main Content: Trace Analysis */ }
        <main className="col-span-6 overflow-y-auto bg-background p-8 custom-scrollbar">
          { !selectedTrace ? (
            <div className="h-full flex flex-col items-center justify-center opacity-20 text-center">
              <Activity className="w-16 h-16 mb-4" />
              <p className="text-sm font-medium uppercase tracking-widest">Select a trace to begin analysis</p>
            </div>
          ) : (
            <div className="max-w-3xl mx-auto space-y-12 pb-20">
              {/* Header Info */ }
              <section>
                <div className="flex items-center gap-2 text-primary mb-2">
                  <Target className="w-5 h-5" />
                  <h2 className="text-lg font-bold tracking-tight">Query Synthesis</h2>
                </div>
                <div className="p-6 rounded-2xl bg-card border border-border shadow-sm">
                  <p className="text-xl font-medium leading-relaxed italic text-foreground/90">
                    "{ selectedTrace.inputQuery }"
                  </p>
                </div>
              </section>

              {/* RAG Fusion Table */ }
              <section>
                <div className="flex items-center gap-2 text-primary mb-4">
                  <GitMerge className="w-5 h-5" />
                  <h2 className="text-sm font-bold uppercase tracking-widest">Hybrid Fusion Matrix</h2>
                </div>
                <div className="rounded-2xl border border-border overflow-hidden bg-card">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-muted/50 border-b border-border">
                        <th className="px-4 py-3 text-[10px] font-bold uppercase text-muted-foreground">Source ID</th>
                        <th className="px-4 py-3 text-[10px] font-bold uppercase text-muted-foreground">Significance Score</th>
                        <th className="px-4 py-3 text-[10px] font-bold uppercase text-muted-foreground text-right">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      { selectedTrace.phases.fusion?.map((c) => (
                        <tr key={ c.id } className="hover:bg-muted/20 transition-colors">
                          <td className="px-4 py-3 text-xs font-mono">#{ c.id }</td>
                          <td className="px-4 py-3">
                            <SaliencyIndicator
                              score={ c.score }
                              threshold={ selectedTrace.labConfig?.saliencyThreshold || 0.65 }
                            />
                          </td>
                          <td className="px-4 py-3 text-right">
                            { c.score >= (selectedTrace.labConfig?.saliencyThreshold || 0.65) ? (
                              <span className="text-[10px] font-bold text-primary uppercase bg-primary/10 px-2 py-1 rounded">Survivor</span>
                            ) : (
                              <span className="text-[10px] font-medium text-muted-foreground uppercase">Evicted</span>
                            ) }
                          </td>
                        </tr>
                      )) }
                    </tbody>
                  </table>
                </div>
              </section>

              {/* Final Prompt Output */ }
              <section>
                <div className="flex items-center gap-2 text-primary mb-4">
                  <FileText className="w-5 h-5" />
                  <h2 className="text-sm font-bold uppercase tracking-widest">Final Prompt Construction</h2>
                </div>
                <div className="p-6 rounded-2xl bg-muted/30 border border-border font-mono text-[13px] leading-relaxed whitespace-pre-wrap text-foreground/80">
                  { selectedTrace.finalizedPrompt }
                </div>
              </section>
            </div>
          ) }
        </main>

        {/* Right Sidebar: Controls */ }
        <aside className="col-span-3 border-l border-border bg-card/30 p-6 flex flex-col gap-8">
          <div>
            <h3 className="text-[11px] font-bold uppercase tracking-widest mb-6 flex items-center gap-2 text-primary">
              <Play className="w-4 h-4" /> Lab Simulation
            </h3>

            <div className="space-y-4">
              <textarea
                value={ inputQuery }
                onChange={ (e) => setInputQuery(e.target.value) }
                placeholder="Enter narrative query..."
                className="w-full h-32 bg-background border border-border rounded-xl p-4 text-sm focus:ring-2 focus:ring-primary/20 transition-all resize-none outline-none"
              />
              <button
                onClick={ handleGenerate }
                disabled={ generating }
                className={ cn(
                  "w-full py-4 border-2 rounded-xl flex items-center justify-center gap-3 font-bold text-xs transition-all",
                  generating 
                    ? "bg-muted text-muted-foreground border-border" 
                    : "bg-primary text-primary-foreground border-primary hover:scale-[1.02] active:scale-95 shadow-lg shadow-primary/20"
                ) }
              >
                { generating ? <Activity className="w-4 h-4 animate-spin" /> : <FlaskConical className="w-4 h-4" /> }
                <span className="uppercase tracking-widest">
                  { generating ? "Synthesizing..." : "Run Simulation" }
                </span>
              </button>
            </div>
          </div>

          <div className="space-y-6">
            <h3 className="text-[11px] font-bold uppercase tracking-widest flex items-center gap-2 text-primary">
              <Settings2 className="w-4 h-4" /> Hyper-Parameters
            </h3>

            {/* Slider: Saliency */ }
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <label className="text-[10px] font-bold text-muted-foreground uppercase">Saliency Gate</label>
                <span className="text-[10px] font-mono font-bold text-primary">{ saliencyThreshold.toFixed(2) }</span>
              </div>
              <input
                type="range" min="0" max="1" step="0.05"
                value={ saliencyThreshold }
                onChange={ (e) => setSaliencyThreshold(parseFloat(e.target.value)) }
                className="w-full accent-primary"
              />
            </div>

            {/* Slider: Dense Weight */ }
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <label className="text-[10px] font-bold text-muted-foreground uppercase">Vector Weight (Dense)</label>
                <span className="text-[10px] font-mono font-bold text-primary">{ weightDense.toFixed(2) }</span>
              </div>
              <input
                type="range" min="0" max="1" step="0.05"
                value={ weightDense }
                onChange={ (e) => setWeightDense(parseFloat(e.target.value)) }
                className="w-full accent-primary"
              />
            </div>

            {/* Checkbox: Temporal */ }
            <div className="flex items-center justify-between p-3 rounded-xl bg-muted/30 border border-border">
              <label className="text-[10px] font-bold text-muted-foreground uppercase">Temporal Phrasing</label>
              <button
                onClick={ () => setTemporalPhrasing(!temporalPhrasing) }
                className={ cn(
                  "w-10 h-5 rounded-full p-1 transition-colors relative",
                  temporalPhrasing ? "bg-primary" : "bg-muted-foreground/30"
                ) }
              >
                <div className={ cn(
                  "w-3 h-3 bg-white rounded-full transition-transform",
                  temporalPhrasing ? "translate-x-5" : "translate-x-0"
                ) } />
              </button>
            </div>

            {/* Status Panel */ }
            <div className={ cn(
              "p-4 rounded-xl border transition-all duration-300 flex items-start gap-3",
              lastGenerationResult?.error ? "bg-destructive/10 border-destructive/20" :
                lastGenerationResult ? "bg-green-500/10 border-green-500/20" : "bg-muted/30 border-border"
            ) }>
              { lastGenerationResult?.error ? (
                <AlertCircle className="w-5 h-5 text-destructive shrink-0" />
              ) : lastGenerationResult ? (
                <CheckCircle2 className="w-5 h-5 text-green-500 shrink-0" />
              ) : (
                <Info className="w-5 h-5 text-muted-foreground shrink-0" />
              ) }
              <div>
                <h4 className="text-[11px] font-bold uppercase tracking-tight">System Status</h4>
                <p className="text-[10px] text-muted-foreground mt-1">
                  { generating ? "Computing narrative fusion..." :
                    lastGenerationResult?.error ? lastGenerationResult.error :
                      lastGenerationResult ? "Context successfully synthesized." :
                        "Ready for simulation." }
                </p>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

export default App;