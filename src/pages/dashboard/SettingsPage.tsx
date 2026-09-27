import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Building2,
  Bell,
  Link as LinkIcon,
  CreditCard,
  Save,
  Upload,
  Mail,
  Globe,
  Key,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Webhook,
  Slack,
  Zap,
  Bot,
  Mic,
  Cpu,
  ShieldCheck,
} from "lucide-react";

export default function SettingsPage() {
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const { user } = useAuth();
  const { toast } = useToast();

  // Company Profile State
  const [companyData, setCompanyData] = useState({
    companyName: "",
    companyGst: "",
    companyCity: "",
    companyState: "",
    companyCountry: "",
    hiringReason: "",
  });

  // Notification Settings
  const [notifications, setNotifications] = useState({
    emailNewApplication: true,
    emailInterviewComplete: true,
    emailFraudAlert: true,
    emailWeeklyDigest: false,
    pushNewApplication: true,
    pushFraudAlert: true,
  });

  useEffect(() => {
    fetchCompanyProfile();
  }, [user]);

  const fetchCompanyProfile = async () => {
    if (!user) return;
    setIsLoading(true);
    
    try {
      const { data, error } = await supabase
        .from("interviewer_profiles")
        .select("*")
        .eq("user_id", user.id)
        .single();

      if (error) throw error;

      if (data) {
        setCompanyData({
          companyName: data.company_name || "",
          companyGst: data.company_gst || "",
          companyCity: data.company_city || "",
          companyState: data.company_state || "",
          companyCountry: data.company_country || "",
          hiringReason: data.hiring_reason || "",
        });
      }
    } catch (error) {
      console.error("Error fetching profile:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const saveCompanyProfile = async () => {
    if (!user) return;
    setIsSaving(true);

    try {
      const { error } = await supabase
        .from("interviewer_profiles")
        .update({
          company_name: companyData.companyName,
          company_gst: companyData.companyGst,
          company_city: companyData.companyCity,
          company_state: companyData.companyState,
          company_country: companyData.companyCountry,
          hiring_reason: companyData.hiringReason,
        })
        .eq("user_id", user.id);

      if (error) throw error;

      toast({
        title: "Settings saved",
        description: "Your company profile has been updated.",
      });
    } catch (error: any) {
      toast({
        title: "Error saving settings",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-muted-foreground">
          Manage your company profile and preferences
        </p>
      </div>

      <Tabs defaultValue="company" className="space-y-6">
        <TabsList className="grid w-full grid-cols-4 lg:w-auto lg:inline-grid">
          <TabsTrigger value="company" className="gap-2">
            <Building2 className="h-4 w-4" />
            <span className="hidden sm:inline">Company</span>
          </TabsTrigger>
          <TabsTrigger value="notifications" className="gap-2">
            <Bell className="h-4 w-4" />
            <span className="hidden sm:inline">Notifications</span>
          </TabsTrigger>
          <TabsTrigger value="integrations" className="gap-2">
            <LinkIcon className="h-4 w-4" />
            <span className="hidden sm:inline">Integrations</span>
          </TabsTrigger>
          <TabsTrigger value="billing" className="gap-2">
            <CreditCard className="h-4 w-4" />
            <span className="hidden sm:inline">Billing</span>
          </TabsTrigger>
        </TabsList>

        {/* Company Profile */}
        <TabsContent value="company">
          <GlassCard>
            <div className="mb-6 flex items-center gap-2">
              <Building2 className="h-5 w-5 text-primary" />
              <h2 className="text-lg font-semibold">Company Profile</h2>
            </div>

            <div className="space-y-6">
              {/* Logo Upload */}
              <div>
                <Label>Company Logo</Label>
                <div className="mt-2 flex items-center gap-4">
                  <div className="flex h-20 w-20 items-center justify-center rounded-lg bg-secondary">
                    <Building2 className="h-8 w-8 text-muted-foreground" />
                  </div>
                  <Button variant="outline">
                    <Upload className="mr-2 h-4 w-4" />
                    Upload Logo
                  </Button>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <Label htmlFor="companyName">Company Name</Label>
                  <Input
                    id="companyName"
                    value={companyData.companyName}
                    onChange={(e) => setCompanyData({ ...companyData, companyName: e.target.value })}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label htmlFor="companyGst">GST Number</Label>
                  <Input
                    id="companyGst"
                    value={companyData.companyGst}
                    onChange={(e) => setCompanyData({ ...companyData, companyGst: e.target.value })}
                    className="mt-1"
                  />
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                <div>
                  <Label htmlFor="city">City</Label>
                  <Input
                    id="city"
                    value={companyData.companyCity}
                    onChange={(e) => setCompanyData({ ...companyData, companyCity: e.target.value })}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label htmlFor="state">State</Label>
                  <Input
                    id="state"
                    value={companyData.companyState}
                    onChange={(e) => setCompanyData({ ...companyData, companyState: e.target.value })}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label htmlFor="country">Country</Label>
                  <Input
                    id="country"
                    value={companyData.companyCountry}
                    onChange={(e) => setCompanyData({ ...companyData, companyCountry: e.target.value })}
                    className="mt-1"
                  />
                </div>
              </div>

              <div>
                <Label htmlFor="hiringReason">Hiring Needs</Label>
                <Textarea
                  id="hiringReason"
                  value={companyData.hiringReason}
                  onChange={(e) => setCompanyData({ ...companyData, hiringReason: e.target.value })}
                  className="mt-1"
                  rows={3}
                />
              </div>

              <div className="flex justify-end">
                <Button onClick={saveCompanyProfile} disabled={isSaving}>
                  {isSaving ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="mr-2 h-4 w-4" />
                  )}
                  Save Changes
                </Button>
              </div>
            </div>
          </GlassCard>
        </TabsContent>

        {/* Notifications */}
        <TabsContent value="notifications">
          <GlassCard>
            <div className="mb-6 flex items-center gap-2">
              <Bell className="h-5 w-5 text-primary" />
              <h2 className="text-lg font-semibold">Notification Preferences</h2>
            </div>

            <div className="space-y-6">
              <div>
                <h3 className="mb-4 flex items-center gap-2 font-medium">
                  <Mail className="h-4 w-4" />
                  Email Notifications
                </h3>
                <div className="space-y-4">
                  {[
                    { key: "emailNewApplication", label: "New application received" },
                    { key: "emailInterviewComplete", label: "Interview completed" },
                    { key: "emailFraudAlert", label: "Fraud alert detected" },
                    { key: "emailWeeklyDigest", label: "Weekly digest summary" },
                  ].map((item) => (
                    <div key={item.key} className="flex items-center justify-between">
                      <span className="text-sm">{item.label}</span>
                      <Switch
                        checked={notifications[item.key as keyof typeof notifications]}
                        onCheckedChange={(checked) => 
                          setNotifications({ ...notifications, [item.key]: checked })
                        }
                      />
                    </div>
                  ))}
                </div>
              </div>

              <div className="border-t border-border pt-6">
                <h3 className="mb-4 flex items-center gap-2 font-medium">
                  <Bell className="h-4 w-4" />
                  Push Notifications
                </h3>
                <div className="space-y-4">
                  {[
                    { key: "pushNewApplication", label: "New applications" },
                    { key: "pushFraudAlert", label: "Fraud alerts" },
                  ].map((item) => (
                    <div key={item.key} className="flex items-center justify-between">
                      <span className="text-sm">{item.label}</span>
                      <Switch
                        checked={notifications[item.key as keyof typeof notifications]}
                        onCheckedChange={(checked) => 
                          setNotifications({ ...notifications, [item.key]: checked })
                        }
                      />
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex justify-end">
                <Button>
                  <Save className="mr-2 h-4 w-4" />
                  Save Preferences
                </Button>
              </div>
            </div>
          </GlassCard>
        </TabsContent>

        {/* Integrations */}
        <TabsContent value="integrations">
          <div className="space-y-6">
            {/* AI & Voice Engine Status Card */}
            <GlassCard>
              <div className="mb-6 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Cpu className="h-5 w-5 text-primary" />
                  <h2 className="text-lg font-semibold">AI & Voice Infrastructure</h2>
                </div>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-500">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  Multi-Key Failover Protected
                </span>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                {/* Groq LLM Engine Card */}
                <div className="rounded-lg border border-border bg-card/50 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-orange-500/10 text-orange-500">
                        <Bot className="h-5 w-5" />
                      </div>
                      <div>
                        <h4 className="font-medium">Groq LLM Engine</h4>
                        <p className="text-xs text-muted-foreground">High-Speed Reasoning Engine</p>
                      </div>
                    </div>
                    <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-500 font-medium">
                      Operational
                    </span>
                  </div>

                  <div className="space-y-1.5 text-xs">
                    <div className="flex justify-between py-1 border-b border-border/50">
                      <span className="text-muted-foreground">Primary Model</span>
                      <span className="font-mono font-medium">openai/gpt-oss-120b</span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-border/50">
                      <span className="text-muted-foreground">Key Architecture</span>
                      <span className="text-foreground">Multi-Key Round-Robin</span>
                    </div>
                    <div className="flex justify-between py-1">
                      <span className="text-muted-foreground">Rate-Limit Strategy</span>
                      <span className="text-foreground">Automatic 429 Cooldown & Failover</span>
                    </div>
                  </div>
                </div>

                {/* Bhashini Voice AI Card */}
                <div className="rounded-lg border border-border bg-card/50 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-500">
                        <Mic className="h-5 w-5" />
                      </div>
                      <div>
                        <h4 className="font-medium">Bhashini Voice AI</h4>
                        <p className="text-xs text-muted-foreground">ASR & TTS Voice Infrastructure</p>
                      </div>
                    </div>
                    <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-500 font-medium">
                      Active
                    </span>
                  </div>

                  <div className="space-y-1.5 text-xs">
                    <div className="flex justify-between py-1 border-b border-border/50">
                      <span className="text-muted-foreground">Supported Languages</span>
                      <span className="font-medium text-foreground">12 Indian Languages</span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-border/50">
                      <span className="text-muted-foreground">Capabilities</span>
                      <span className="text-foreground">Bi-directional Speech-to-Text & TTS</span>
                    </div>
                    <div className="flex justify-between py-1">
                      <span className="text-muted-foreground">Credential Security</span>
                      <span className="text-foreground">Server-Side Protected</span>
                    </div>
                  </div>
                </div>
              </div>
            </GlassCard>

            <GlassCard>
              <div className="mb-6 flex items-center gap-2">
                <LinkIcon className="h-5 w-5 text-primary" />
                <h2 className="text-lg font-semibold">Third-Party Integrations</h2>
              </div>

              <div className="space-y-4">
                {/* Webhook */}
                <div className="flex items-center justify-between rounded-lg border border-border p-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                      <Webhook className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <h4 className="font-medium">Webhooks</h4>
                      <p className="text-sm text-muted-foreground">
                        Receive real-time updates via webhooks
                      </p>
                    </div>
                  </div>
                  <Button variant="outline">Configure</Button>
                </div>

                {/* Slack */}
                <div className="flex items-center justify-between rounded-lg border border-border p-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#4A154B]/10">
                      <Slack className="h-5 w-5 text-[#4A154B]" />
                    </div>
                    <div>
                      <h4 className="font-medium">Slack</h4>
                      <p className="text-sm text-muted-foreground">
                        Get notifications in your Slack workspace
                      </p>
                    </div>
                  </div>
                  <Button variant="outline">Connect</Button>
                </div>

                {/* Zapier */}
                <div className="flex items-center justify-between rounded-lg border border-border p-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#FF4F00]/10">
                      <Zap className="h-5 w-5 text-[#FF4F00]" />
                    </div>
                    <div>
                      <h4 className="font-medium">Zapier</h4>
                      <p className="text-sm text-muted-foreground">
                        Connect with 5000+ apps via Zapier
                      </p>
                    </div>
                  </div>
                  <Button variant="outline">Connect</Button>
                </div>

                {/* API Key */}
                <div className="rounded-lg border border-border p-4">
                  <div className="mb-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-secondary">
                        <Key className="h-5 w-5" />
                      </div>
                      <div>
                        <h4 className="font-medium">API Key</h4>
                        <p className="text-sm text-muted-foreground">
                          Use our REST API for custom integrations
                        </p>
                      </div>
                    </div>
                    <Button variant="outline">Generate Key</Button>
                  </div>
                  <div className="rounded-lg bg-secondary/50 p-3">
                    <code className="text-sm text-muted-foreground">
                      No API key generated yet
                    </code>
                  </div>
                </div>
              </div>
            </GlassCard>
          </div>
        </TabsContent>

        {/* Billing */}
        <TabsContent value="billing">
          <GlassCard>
            <div className="mb-6 flex items-center gap-2">
              <CreditCard className="h-5 w-5 text-primary" />
              <h2 className="text-lg font-semibold">Billing & Subscription</h2>
            </div>

            <div className="space-y-6">
              {/* Current Plan */}
              <div className="rounded-lg border border-primary/30 bg-primary/5 p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="rounded-full bg-primary/20 px-2 py-0.5 text-xs font-medium text-primary">
                      Current Plan
                    </span>
                    <h3 className="mt-2 text-2xl font-bold">Pro Plan</h3>
                    <p className="text-muted-foreground">₹9,999/month</p>
                  </div>
                  <Button variant="outline">Upgrade Plan</Button>
                </div>
                <div className="mt-4 grid gap-2 text-sm">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-success" />
                    Unlimited job postings
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-success" />
                    500 AI interviews/month
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-success" />
                    Advanced analytics
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-success" />
                    Priority support
                  </div>
                </div>
              </div>

              {/* Usage */}
              <div>
                <h3 className="mb-4 font-medium">Current Usage</h3>
                <div className="space-y-3">
                  <div>
                    <div className="mb-1 flex justify-between text-sm">
                      <span>AI Interviews</span>
                      <span>156 / 500</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-secondary">
                      <div className="h-full w-[31%] rounded-full bg-primary" />
                    </div>
                  </div>
                  <div>
                    <div className="mb-1 flex justify-between text-sm">
                      <span>Storage Used</span>
                      <span>2.4 GB / 10 GB</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-secondary">
                      <div className="h-full w-[24%] rounded-full bg-primary" />
                    </div>
                  </div>
                </div>
              </div>

              {/* Payment Method */}
              <div>
                <h3 className="mb-4 font-medium">Payment Method</h3>
                <div className="flex items-center justify-between rounded-lg border border-border p-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-secondary">
                      <CreditCard className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="font-medium">•••• •••• •••• 4242</p>
                      <p className="text-sm text-muted-foreground">Expires 12/25</p>
                    </div>
                  </div>
                  <Button variant="ghost" size="sm">Update</Button>
                </div>
              </div>

              {/* Invoices */}
              <div>
                <h3 className="mb-4 font-medium">Recent Invoices</h3>
                <div className="space-y-2">
                  {[
                    { date: "Feb 1, 2024", amount: "₹9,999", status: "Paid" },
                    { date: "Jan 1, 2024", amount: "₹9,999", status: "Paid" },
                    { date: "Dec 1, 2023", amount: "₹9,999", status: "Paid" },
                  ].map((invoice, idx) => (
                    <div key={idx} className="flex items-center justify-between rounded-lg bg-secondary/50 p-3">
                      <div>
                        <p className="text-sm font-medium">{invoice.date}</p>
                        <p className="text-sm text-muted-foreground">{invoice.amount}</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="rounded-full bg-success/10 px-2 py-0.5 text-xs text-success">
                          {invoice.status}
                        </span>
                        <Button variant="ghost" size="sm">Download</Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </GlassCard>
        </TabsContent>
      </Tabs>
    </div>
  );
}
