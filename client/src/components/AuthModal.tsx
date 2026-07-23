import { useState, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/use-auth";
import { Loader2 } from "lucide-react";

interface AuthModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** If true, show register tab by default. Otherwise show login. */
  defaultMode?: "login" | "register";
}

export function AuthModal({ open, onOpenChange, defaultMode = "login" }: AuthModalProps) {
  const { login, register, checkUsername, isAuthenticated } = useAuth();
  const [mode, setMode] = useState<"login" | "register">(defaultMode);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [usernameAvailable, setUsernameAvailable] = useState<boolean | null>(null);
  const [checkingUsername, setCheckingUsername] = useState(false);

  // Reset state when dialog opens
  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        setUsername("");
        setPassword("");
        setError(null);
        setIsSubmitting(false);
        setUsernameAvailable(null);
      }
      onOpenChange(open);
    },
    [onOpenChange],
  );

  // Check username availability as user types (register mode only)
  const handleUsernameChange = useCallback(
    async (value: string) => {
      setUsername(value);
      setError(null);
      if (mode === "register" && value.length >= 3) {
        setCheckingUsername(true);
        const available = await checkUsername(value);
        // "error" means the check failed — don't block registration, don't
        // show misleading "username is taken" message.
        setUsernameAvailable(available === true);
        setCheckingUsername(false);
      } else {
        setUsernameAvailable(null);
      }
    },
    [mode, checkUsername],
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmedUser = username.trim();
    const trimmedPass = password;

    if (!trimmedUser || !trimmedPass) {
      setError("Username and password are required");
      return;
    }

    setIsSubmitting(true);

    try {
      const result =
        mode === "login"
          ? await login(trimmedUser, trimmedPass)
          : await register(trimmedUser, trimmedPass);

      if (!result.ok) {
        setError(result.message);
        return;
      }

      handleOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred");
    } finally {
      setIsSubmitting(false);
    }
  };

  const switchMode = useCallback(() => {
    setMode((m) => (m === "login" ? "register" : "login"));
    setError(null);
    setUsernameAvailable(null);
  }, []);

  // If already authenticated, just show a quick confirmation
  if (isAuthenticated) {
    return (
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-md bg-zinc-950 border border-white/10">
          <DialogHeader>
            <DialogTitle className="font-serif text-2xl text-white">
              Signed In
            </DialogTitle>
            <DialogDescription className="text-white/60">
              You're already signed in. Close this window to continue reading.
            </DialogDescription>
          </DialogHeader>
          <Button
            onClick={() => handleOpenChange(false)}
            className="w-full bg-primary/90 hover:bg-primary text-primary-foreground"
          >
            Continue Reading
          </Button>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md bg-zinc-950 border border-white/10">
        <DialogHeader>
          <DialogTitle className="font-serif text-2xl text-white">
            {mode === "login" ? "Welcome Back" : "Create Account"}
          </DialogTitle>
          <DialogDescription className="text-white/60">
            {mode === "login"
              ? "Sign in to track your reading progress and join discussions."
              : "Register to track your progress and participate in the community."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label
              htmlFor="auth-username"
              className="text-sm font-medium text-white/70"
            >
              Username
            </label>
            <Input
              id="auth-username"
              type="text"
              placeholder="Your username"
              value={username}
              onChange={(e) => handleUsernameChange(e.target.value)}
              className="bg-black/60 border-white/10 text-white placeholder:text-white/30"
              autoComplete="username"
              disabled={isSubmitting}
              minLength={3}
              maxLength={30}
              required
            />
            {mode === "register" && username.length >= 3 && (
              <p
                className={`text-xs ${
                  checkingUsername
                    ? "text-white/40"
                    : usernameAvailable
                      ? "text-green-400"
                      : "text-red-400"
                }`}
              >
                {checkingUsername
                  ? "Checking..."
                  : usernameAvailable
                    ? "Username available"
                    : "Username is taken"}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <label
              htmlFor="auth-password"
              className="text-sm font-medium text-white/70"
            >
              Password
            </label>
            <Input
              id="auth-password"
              type="password"
              placeholder={mode === "register" ? "At least 6 characters" : "Your password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="bg-black/60 border-white/10 text-white placeholder:text-white/30"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              disabled={isSubmitting}
              minLength={mode === "register" ? 6 : 1}
              required
            />
          </div>

          {error && (
            <p className="text-sm text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <Button
            type="submit"
            disabled={isSubmitting || (mode === "register" && usernameAvailable === false)}
            className="w-full bg-primary/90 hover:bg-primary text-primary-foreground h-12 text-base"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                {mode === "login" ? "Signing in..." : "Creating account..."}
              </>
            ) : mode === "login" ? (
              "Sign In"
            ) : (
              "Create Account"
            )}
          </Button>
        </form>

        <div className="text-center">
          <button
            type="button"
            onClick={switchMode}
            className="text-sm text-primary/70 hover:text-primary transition-colors"
          >
            {mode === "login"
              ? "Don't have an account? Register"
              : "Already have an account? Sign in"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
