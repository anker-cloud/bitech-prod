import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Eye, EyeOff, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth-context";
import { loginSchema, type LoginCredentials } from "@shared/schema";
import { ThemeToggle } from "@/components/theme-toggle";
import bitechLogo from "@/assets/bitech-logo.png";
import loginCharacter from "@/assets/images/login-character.png";

export default function LoginPage() {
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const { login } = useAuth();
  const { toast } = useToast();

  const form = useForm<LoginCredentials>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  });

  async function onSubmit(values: LoginCredentials) {
    setIsLoading(true);
    try {
      await login(values.email, values.password);
      toast({
        title: "Welcome back!",
        description: "You have successfully logged in.",
      });
    } catch (error) {
      toast({
        title: "Login failed",
        description: error instanceof Error ? error.message : "Invalid credentials",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-primary/5 p-4">
      <div className="w-full max-w-4xl bg-background rounded-2xl shadow-xl overflow-hidden flex relative">
        <div className="absolute top-4 right-4 z-10">
          <ThemeToggle />
        </div>

        <div className="hidden md:flex w-1/2 bg-primary/10 items-center justify-center p-8 relative">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/20 via-primary/10 to-transparent" />
          <div className="relative z-10">
            <img 
              src={loginCharacter} 
              alt="AI Assistant" 
              className="w-full max-w-sm h-auto"
              data-testid="img-login-character"
            />
          </div>
          <div className="absolute bottom-8 left-8 right-8">
            <div className="flex items-center gap-2">
              <div className="h-2 w-16 bg-primary/40 rounded-full" />
              <div className="h-2 w-24 bg-primary/30 rounded-full" />
            </div>
            <div className="flex items-center gap-2 mt-2">
              <div className="h-2 w-2 bg-primary/50 rounded-full" />
              <div className="h-2 w-20 bg-primary/30 rounded-full" />
            </div>
          </div>
        </div>

        <div className="w-full md:w-1/2 p-8 md:p-12 flex flex-col justify-center">
          <div className="flex flex-col items-center mb-8">
            <img src={bitechLogo} alt="Bitech" className="h-10 w-auto mb-4" data-testid="img-bitech-logo" />
            <p className="text-sm text-muted-foreground">DC4AI - Data Collection 4 AI</p>
          </div>

          <h1 className="text-2xl font-bold text-center mb-8">Login</h1>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-sm font-medium">Email</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <div className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                          <Mail className="h-4 w-4" />
                        </div>
                        <div className="absolute left-10 top-1/2 -translate-y-1/2 h-5 w-px bg-border" />
                        <Input
                          type="email"
                          placeholder="you@example.com"
                          autoComplete="email"
                          data-testid="input-email"
                          className="pl-12 h-11 rounded-lg border-border"
                          {...field}
                        />
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-sm font-medium">Password</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <button
                          type="button"
                          className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                          onClick={() => setShowPassword(!showPassword)}
                          data-testid="button-toggle-password"
                        >
                          {showPassword ? (
                            <EyeOff className="h-4 w-4" />
                          ) : (
                            <Eye className="h-4 w-4" />
                          )}
                        </button>
                        <div className="absolute left-10 top-1/2 -translate-y-1/2 h-5 w-px bg-border" />
                        <Input
                          type={showPassword ? "text" : "password"}
                          placeholder="Enter your password"
                          autoComplete="current-password"
                          data-testid="input-password"
                          className="pl-12 h-11 rounded-lg border-border"
                          {...field}
                        />
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="flex justify-end">
                <button 
                  type="button" 
                  className="text-sm text-primary hover:underline"
                  data-testid="link-forgot-password"
                >
                  Forgot Password?
                </button>
              </div>

              <Button
                type="submit"
                className="w-full h-11 rounded-lg text-base font-medium"
                disabled={isLoading}
                data-testid="button-login"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Signing in...
                  </>
                ) : (
                  "Log In"
                )}
              </Button>
            </form>
          </Form>

          <p className="text-center text-xs text-muted-foreground mt-8">
            Protected by AWS Cognito authentication
          </p>
        </div>
      </div>
    </div>
  );
}
