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
import loginHeroFull from "@/assets/images/login-hero-full.png";

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
      <div 
        className="hidden lg:block lg:w-1/2 xl:w-3/5 relative"
        style={{
          backgroundImage: `url(${loginHeroFull})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
        data-testid="section-login-hero"
      >
        <div className="absolute inset-0 bg-gradient-to-r from-transparent to-black/5" />
      </div>

      <div className="w-full lg:w-1/2 xl:w-2/5 flex flex-col bg-background">
        <header className="flex items-center justify-end p-4">
          <ThemeToggle />
        </header>

        <main className="flex-1 flex items-center justify-center p-8">
          <div className="w-full max-w-sm space-y-8">
            <div className="flex flex-col items-center space-y-4">
              <img src={bitechLogo} alt="Bitech" className="h-12 w-auto" data-testid="img-bitech-logo" />
              <div className="text-center">
                <h1 className="text-2xl font-bold tracking-tight">DC4AI</h1>
                <p className="text-muted-foreground mt-1 text-sm">
                  Data Collection 4 Artificial Intelligence
                </p>
              </div>
            </div>

            <div className="space-y-6">
              <div className="text-center">
                <h2 className="text-xl font-semibold">Login</h2>
              </div>

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
                              className="pl-12 h-11 rounded-lg"
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
                              className="pl-12 h-11 rounded-lg"
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
