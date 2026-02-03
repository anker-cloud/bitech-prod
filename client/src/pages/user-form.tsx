import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, useParams } from "wouter";
import { Users, ArrowLeft, Loader2, Check, X, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { User, Role } from "@shared/schema";

export default function UserFormPage() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const isEditing = !!id;

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [roleId, setRoleId] = useState<string>("");
  const [isActive, setIsActive] = useState(true);

  const { data: existingUser, isLoading: isLoadingUser } = useQuery<User & { role?: Role }>({
    queryKey: ["/api/users", id],
    enabled: isEditing,
  });

  const { data: roles, isLoading: isLoadingRoles } = useQuery<Role[]>({
    queryKey: ["/api/roles"],
  });

  useEffect(() => {
    if (existingUser) {
      setName(existingUser.name);
      setEmail(existingUser.email);
      setRoleId(existingUser.roleId || "");
      setIsActive(existingUser.isActive);
    }
  }, [existingUser]);

  const saveMutation = useMutation({
    mutationFn: async (data: { name: string; email: string; password?: string; roleId: string; isActive: boolean }) => {
      if (isEditing) {
        return await apiRequest("PATCH", `/api/users/${id}`, data);
      } else {
        return await apiRequest("POST", "/api/users", data);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      queryClient.invalidateQueries({ queryKey: ["/api/roles/user-counts"] });
      toast({
        title: isEditing ? "User updated" : "User created",
        description: `The user has been successfully ${isEditing ? "updated" : "created"}.`,
      });
      navigate("/users");
    },
    onError: (error: Error) => {
      toast({
        title: `Failed to ${isEditing ? "update" : "create"} user`,
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!name.trim()) {
      toast({ title: "Validation error", description: "Name is required", variant: "destructive" });
      return;
    }
    if (!email.trim()) {
      toast({ title: "Validation error", description: "Email is required", variant: "destructive" });
      return;
    }
    if (!isEditing && !password) {
      toast({ title: "Validation error", description: "Password is required for new users", variant: "destructive" });
      return;
    }
    if (!isEditing && password.length < 8) {
      toast({ title: "Validation error", description: "Password must be at least 8 characters", variant: "destructive" });
      return;
    }
    if (!roleId) {
      toast({ title: "Validation error", description: "Please select a role", variant: "destructive" });
      return;
    }

    const data: { name: string; email: string; password?: string; roleId: string; isActive: boolean } = {
      name: name.trim(),
      email: email.trim(),
      roleId,
      isActive,
    };

    if (password) {
      data.password = password;
    }

    saveMutation.mutate(data);
  };

  if (isEditing && isLoadingUser) {
    return (
      <div className="p-4 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-4 p-4 border-b">
        <Button variant="ghost" size="icon" onClick={() => navigate("/users")} data-testid="button-back">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex items-center gap-2">
          <Users className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-semibold">{isEditing ? "Edit User" : "Create User"}</h1>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <form onSubmit={handleSubmit} className="p-4 space-y-6 max-w-2xl">
          <Card>
            <CardHeader>
              <CardTitle>User Details</CardTitle>
              <CardDescription>
                {isEditing
                  ? "Update user information and role assignment"
                  : "Create a new user with AWS Cognito credentials"}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Name *</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="John Doe"
                  data-testid="input-user-name"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="email">Email *</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="john@example.com"
                  data-testid="input-user-email"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">
                  Password {isEditing ? "(leave blank to keep current)" : "*"}
                </Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={isEditing ? "Enter new password" : "Minimum 8 characters"}
                    data-testid="input-user-password"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-0 top-0 h-full px-3"
                    onClick={() => setShowPassword(!showPassword)}
                    data-testid="button-toggle-password-visibility"
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <Eye className="h-4 w-4 text-muted-foreground" />
                    )}
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="role">Role *</Label>
                {isLoadingRoles ? (
                  <Skeleton className="h-10 w-full" />
                ) : (
                  <Select value={roleId} onValueChange={setRoleId}>
                    <SelectTrigger data-testid="select-user-role">
                      <SelectValue placeholder="Select a role" />
                    </SelectTrigger>
                    <SelectContent>
                      {roles?.map((role) => (
                        <SelectItem key={role.id} value={role.id}>
                          {role.name} {role.isAdmin && "(Admin)"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <p className="text-xs text-muted-foreground">
                  The user's role determines their data access permissions
                </p>
              </div>

              {isEditing && (
                <div className="flex items-center justify-between rounded-md border p-4">
                  <div className="space-y-0.5">
                    <Label htmlFor="active-toggle">Account Active</Label>
                    <p className="text-sm text-muted-foreground">
                      Inactive users cannot log in or access data
                    </p>
                  </div>
                  <Switch
                    id="active-toggle"
                    checked={isActive}
                    onCheckedChange={setIsActive}
                    data-testid="switch-user-active"
                  />
                </div>
              )}
            </CardContent>
          </Card>

          <div className="flex items-center gap-4">
            <Button
              type="submit"
              disabled={saveMutation.isPending}
              data-testid="button-save-user"
            >
              {saveMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {isEditing ? "Updating..." : "Creating..."}
                </>
              ) : (
                <>
                  <Check className="h-4 w-4 mr-2" />
                  {isEditing ? "Update User" : "Create User"}
                </>
              )}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => navigate("/users")}
              data-testid="button-cancel"
            >
              <X className="h-4 w-4 mr-2" />
              Cancel
            </Button>
          </div>
        </form>
      </ScrollArea>
    </div>
  );
}
