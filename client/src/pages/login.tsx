import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth-context";
import { loginSchema, type LoginCredentials } from "@shared/schema";
import { ThemeToggle } from "@/components/theme-toggle";
import bitechLogo from "@/assets/bitech-logo.png";
import loginHero from "@/assets/images/login-hero.png";

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
    <div className="min-h-screen flex">
      <div className="hidden lg:flex flex-1 bg-muted/30 items-center justify-center p-8 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-transparent to-primary/5" />
        <div className="relative z-10 max-w-2xl w-full">
          <img 
            src={loginHero} 
            alt="AI and Data Analytics" 
            className="w-full h-auto rounded-lg shadow-2xl"
            data-testid="img-login-hero"
          />
          <div className="mt-8 text-center">
            <h2 className="text-2xl font-semibold text-foreground">
              Intelligent Data Access
            </h2>
            <p className="mt-2 text-muted-foreground max-w-md mx-auto">
              Harness the power of AI-driven analytics with secure, role-based access to your enterprise data sources.
            </p>
          </div>
        </div>
      </div>

      <div className="w-full lg:w-[420px] xl:w-[480px] flex flex-col bg-background border-l">
        <header className="flex items-center justify-end p-4">
          <ThemeToggle />
        </header>
        
        <main className="flex-1 flex items-center justify-center p-6">
          <div className="w-full max-w-sm space-y-8">
            <div className="flex flex-col items-center space-y-4">
              <img src={bitechLogo} alt="Bitech" className="h-12 w-auto" data-testid="img-bitech-logo" />
              <div className="text-center">
                <h1 className="text-2xl font-bold tracking-tight">DC4AI</h1>
                <p className="text-muted-foreground mt-1">
                  Data Collection 4 Artificial Intelligence
                </p>
              </div>
            </div>

            <div className="space-y-6">
              <div className="space-y-2 text-center">
                <h2 className="text-xl font-semibold">Sign in</h2>
                <p className="text-sm text-muted-foreground">
                  Enter your credentials to access the platform
                </p>
              </div>

              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                  <FormField
                    control={form.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Email</FormLabel>
                        <FormControl>
                          <Input
                            type="email"
                            placeholder="you@example.com"
                            autoComplete="email"
                            data-testid="input-email"
                            {...field}
                          />
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
                        <FormLabel>Password</FormLabel>
                        <FormControl>
                          <div className="relative">
                            <Input
                              type={showPassword ? "text" : "password"}
                              placeholder="Enter your password"
                              autoComplete="current-password"
                              data-testid="input-password"
                              className="pr-10"
                              {...field}
                            />
                            <button
                              type="button"
                              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                              onClick={() => setShowPassword(!showPassword)}
                              data-testid="button-toggle-password"
                            >
                              {showPassword ? (
                                <EyeOff className="h-4 w-4" />
                              ) : (
                                <Eye className="h-4 w-4" />
                              )}
                            </button>
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <Button
                    type="submit"
                    className="w-full"
                    disabled={isLoading}
                    data-testid="button-login"
                  >
                    {isLoading ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Signing in...
                      </>
                    ) : (
                      "Sign in"
                    )}
                  </Button>
                </form>
              </Form>
            </div>

            <p className="text-center text-xs text-muted-foreground">
              Protected by AWS Cognito authentication
            </p>
          </div>
        </main>
      </div>
    </div>
  );
}
