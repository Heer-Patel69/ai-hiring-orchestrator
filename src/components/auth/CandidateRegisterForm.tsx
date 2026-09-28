import { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GlassCard } from "@/components/ui/glass-card";
import { PasswordStrength } from "./PasswordStrength";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  User,
  Mail,
  Lock,
  Phone,
  Github,
  Linkedin,
  FileText,
  Upload,
  Loader2,
  ArrowLeft,
  ArrowRight,
  Check,
  Sparkles,
  AlertCircle,
} from "lucide-react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { extractResumeText, fallbackParseResumeText } from "@/lib/resume-extractor";

const formSchema = z.object({
  fullName: z.string().min(2, "Full name must be at least 2 characters"),
  phoneNumber: z.string().min(10, "Invalid phone number").max(15),
  email: z.string().email("Invalid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  confirmPassword: z.string(),
  githubUrl: z.string().url("Please enter a valid GitHub URL").refine(
    (url) => url.includes("github.com"),
    "Must be a valid GitHub profile URL"
  ),
  linkedinUrl: z.string().url("Please enter a valid LinkedIn URL").refine(
    (url) => url.includes("linkedin.com"),
    "Must be a valid LinkedIn profile URL"
  ),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"],
});

type FormData = z.infer<typeof formSchema>;

interface ResumeData {
  fullName: string | null;
  email: string | null;
  phone: string | null;
  location: string | null;
  skills: string[];
  experience_years: number;
  education: Array<{
    degree: string;
    institution: string;
    year: number;
    field?: string;
    gpa?: string;
  }>;
  workExperience: Array<{
    company: string;
    title: string;
    duration: string;
    description: string;
  }>;
  projects: Array<{
    name: string;
    description: string;
    technologies: string[];
  }>;
  certifications: string[];
  languages: string[];
  summary: string | null;
  github_url: string | null;
  linkedin_url: string | null;
  portfolio_url: string | null;
  confidence_scores: {
    fullName: "high" | "medium" | "low";
    email: "high" | "medium" | "low";
    phone: "high" | "medium" | "low";
    skills: "high" | "medium" | "low";
    experience: "high" | "medium" | "low";
    education: "high" | "medium" | "low";
  };
  validation_warnings: string[];
  suggested_job_preferences: {
    fields: string[];
    experience_level: string;
    roles: string[];
    work_type: string[];
  };
}

const steps = ["Account", "Professional"];

export function CandidateRegisterForm() {
  const [currentStep, setCurrentStep] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [isParsingResume, setIsParsingResume] = useState(false);
  const [parsedResumeData, setParsedResumeData] = useState<ResumeData | null>(null);
  const [extractedSkills, setExtractedSkills] = useState<string[]>([]);
  const { toast } = useToast();
  const navigate = useNavigate();

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      fullName: "",
      phoneNumber: "",
      email: "",
      password: "",
      confirmPassword: "",
      githubUrl: "",
      linkedinUrl: "",
    },
  });

  // Parse resume using AI
  const parseResume = useCallback(async (file: File) => {
    setIsParsingResume(true);
    
    try {
      // Robust client-side text extraction for PDF / DOCX
      const { text } = await extractResumeText(file);

      let data: ResumeData | null = null;

      // Try AI edge function first
      try {
        const response = await supabase.functions.invoke("parse-resume-direct", {
          body: { text, fileName: file.name },
        });

        if (!response.error && response.data?.data) {
          data = response.data.data as ResumeData;
        }
      } catch (invokeErr) {
        console.warn("Edge function parse-resume-direct not reached, using client parser:", invokeErr);
      }

      // If edge function returned 404 or failed, parse client-side
      if (!data) {
        data = fallbackParseResumeText(text) as unknown as ResumeData;
      }

      if (data) {
        setParsedResumeData(data);
        setExtractedSkills(data.skills || []);

        // Auto-fill form fields
        if (data.fullName && !form.getValues("fullName")) {
          form.setValue("fullName", data.fullName);
        }
        if (data.email && !form.getValues("email")) {
          form.setValue("email", data.email);
        }
        if (data.phone && !form.getValues("phoneNumber")) {
          form.setValue("phoneNumber", data.phone);
        }
        // Auto-fill GitHub and LinkedIn if found
        if (data.github_url && !form.getValues("githubUrl")) {
          form.setValue("githubUrl", data.github_url);
        }
        if (data.linkedin_url && !form.getValues("linkedinUrl")) {
          form.setValue("linkedinUrl", data.linkedin_url);
        }

        // Show success with details
        toast({
          title: "Resume parsed successfully!",
          description: `Extracted ${data.skills?.length || 0} skills and profile details.`,
        });
      }
    } catch (error: any) {
      console.error("Resume parsing error:", error);
      toast({
        title: "Resume text extracted",
        description: "Please confirm your details below.",
      });
    } finally {
      setIsParsingResume(false);
    }
  }, [form, toast]);

  const handleFileChange = async (
    e: React.ChangeEvent<HTMLInputElement>,
    type: "resume"
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      toast({
        title: "File too large",
        description: "File must be less than 5MB",
        variant: "destructive",
      });
      return;
    }

    const validExtensions = ["pdf", "docx", "doc"];
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (type === "resume" && !validExtensions.includes(ext || "")) {
      toast({
        title: "Invalid file type",
        description: "Please upload a PDF or DOCX file",
        variant: "destructive",
      });
      return;
    }

    setResumeFile(file);
    
    // Automatically parse the resume
    await parseResume(file);
  };

  const onSubmit = async (data: FormData) => {
    if (!resumeFile) {
      toast({
        title: "Resume required",
        description: "Please upload your resume",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);
    try {
      // 1. Sign up the user
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: data.email,
        password: data.password,
        options: {
          emailRedirectTo: window.location.origin,
        },
      });

      if (authError) throw authError;
      if (!authData.user) throw new Error("Failed to create user");

      const userId = authData.user.id;

      // 2. Upload resume first (fast operation)
      const resumeExt = resumeFile.name.split(".").pop();
      const resumePath = `${userId}/resume.${resumeExt}`;
      
      const resumeResult = await supabase.storage.from("resumes").upload(resumePath, resumeFile);
      if (resumeResult.error) throw resumeResult.error;

      // 3. Create user role FIRST (critical for login) with retry
      let roleCreated = false;
      for (let attempt = 0; attempt < 3 && !roleCreated; attempt++) {
        const { error: roleError } = await supabase
          .from("user_roles")
          .insert({ user_id: userId, role: "candidate" });
        
        if (!roleError) {
          roleCreated = true;
        } else if (roleError.code !== "23505") { // Not a duplicate key error
          console.error(`Role creation attempt ${attempt + 1} failed:`, roleError);
          if (attempt === 2) throw roleError;
          await new Promise(r => setTimeout(r, 100)); // Brief retry delay
        } else {
          roleCreated = true; // Already exists
        }
      }

      // 4. Create profiles in parallel (non-critical for login)
      const [profileResult] = await Promise.all([
        supabase.from("profiles").insert({
          user_id: userId,
          full_name: data.fullName,
          email: data.email,
        }),
        supabase.from("candidate_profiles").insert({
          user_id: userId,
          // CRITICAL: store full_name and email so identity resolves without joining profiles
          full_name: data.fullName,
          email: data.email,
          phone_number: data.phoneNumber,
          github_url: data.githubUrl,
          linkedin_url: data.linkedinUrl,
          resume_url: resumePath,
          verification_status: "verified",
          skills: extractedSkills,
          experience_years: parsedResumeData?.experience_years || null,
          education: parsedResumeData?.education || null,
          projects: parsedResumeData?.projects || null,
          certifications: parsedResumeData?.certifications || null,
        }),
      ]);

      if (profileResult.error) throw profileResult.error;

      // 4. Trigger profile analysis in background (non-blocking)
      supabase.functions.invoke("analyze-profile", {
        body: {
          github_url: data.githubUrl,
          linkedin_url: data.linkedinUrl,
          candidate_id: userId,
        },
      }).catch(console.error);

      toast({
        title: "Registration successful!",
        description: "Your profile is ready. You can now sign in and start applying for jobs!",
      });

      navigate("/login");
    } catch (error: any) {
      console.error("Registration error:", error);
      toast({
        title: "Registration failed",
        description: error.message || "Something went wrong",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const nextStep = async () => {
    const fieldsToValidate = currentStep === 0 
      ? ["fullName", "phoneNumber", "email", "password", "confirmPassword"] as const
      : ["githubUrl", "linkedinUrl"] as const;

    const result = await form.trigger(fieldsToValidate);
    if (result) setCurrentStep((prev) => Math.min(prev + 1, steps.length - 1));
  };

  const prevStep = () => setCurrentStep((prev) => Math.max(prev - 1, 0));

  return (
    <GlassCard className="w-full max-w-2xl mx-auto">
      {/* Progress Steps */}
      <div className="flex items-center justify-center gap-2 mb-8">
        {steps.map((step, index) => (
          <div key={step} className="flex items-center">
            <div className="flex flex-col items-center">
              <motion.div
                initial={{ scale: 0.8 }}
                animate={{
                  scale: index === currentStep ? 1.1 : 1,
                  backgroundColor:
                    index < currentStep
                      ? "hsl(var(--success))"
                      : index === currentStep
                      ? "hsl(var(--success))"
                      : "hsl(var(--secondary))",
                }}
                className="flex h-10 w-10 items-center justify-center rounded-full text-sm font-medium text-primary-foreground"
              >
                {index < currentStep ? <Check className="h-5 w-5" /> : index + 1}
              </motion.div>
              <span className="mt-2 text-xs font-medium text-muted-foreground">
                {step}
              </span>
            </div>
            {index < steps.length - 1 && (
              <div className={`mx-3 h-0.5 w-12 ${index < currentStep ? "bg-success" : "bg-secondary"}`} />
            )}
          </div>
        ))}
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          {/* Step 1: Account Details */}
          {currentStep === 0 && (
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-4"
            >
              <h2 className="text-xl font-semibold flex items-center gap-2">
                <User className="h-5 w-5 text-success" />
                Personal Details
              </h2>

              {/* Resume Upload - First for auto-fill */}
              <div className="mb-6">
                <Label className="flex items-center gap-2">
                  <FileText className="h-4 w-4" />
                  Resume (PDF only, max 5MB)
                  <Badge variant="secondary" className="ml-2">
                    <Sparkles className="h-3 w-3 mr-1" />
                    AI Auto-fill
                  </Badge>
                </Label>
                <div className="mt-2">
                  <label className="cursor-pointer block">
                    <div className={`flex items-center justify-center gap-3 p-6 rounded-lg border-2 border-dashed transition-colors ${
                      isParsingResume 
                        ? "border-primary bg-primary/10 animate-pulse" 
                        : resumeFile 
                        ? "border-success bg-success/10" 
                        : "border-border hover:border-primary hover:bg-secondary/50"
                    }`}>
                      {isParsingResume ? (
                        <>
                          <Loader2 className="h-5 w-5 text-primary animate-spin" />
                          <span className="text-sm text-primary">Analyzing resume with AI...</span>
                        </>
                      ) : resumeFile ? (
                        <>
                          <Check className="h-5 w-5 text-success" />
                          <span className="text-sm">{resumeFile.name}</span>
                        </>
                      ) : (
                        <>
                          <Upload className="h-5 w-5 text-muted-foreground" />
                          <span className="text-sm text-muted-foreground">
                            Upload resume to auto-fill your details
                          </span>
                        </>
                      )}
                    </div>
                    <input
                      type="file"
                      accept=".pdf,.docx,.doc,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                      className="hidden"
                      onChange={(e) => handleFileChange(e, "resume")}
                      disabled={isParsingResume}
                    />
                  </label>
                </div>

                {/* Show extracted skills preview */}
                {extractedSkills.length > 0 && (
                  <motion.div 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mt-4 p-4 rounded-lg bg-success/10 border border-success/20"
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <Check className="h-4 w-4 text-success" />
                      <span className="text-sm font-medium text-success">Skills extracted from resume</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {extractedSkills.slice(0, 10).map((skill, idx) => (
                        <Badge key={idx} variant="outline" className="text-xs">
                          {skill}
                        </Badge>
                      ))}
                      {extractedSkills.length > 10 && (
                        <Badge variant="secondary" className="text-xs">
                          +{extractedSkills.length - 10} more
                        </Badge>
                      )}
                    </div>
                    {parsedResumeData?.experience_years && parsedResumeData.experience_years > 0 && (
                      <p className="text-xs text-muted-foreground mt-2">
                        Experience: ~{parsedResumeData.experience_years} years
                      </p>
                    )}
                  </motion.div>
                )}
              </div>

              <FormField
                control={form.control}
                name="fullName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Full Name</FormLabel>
                    <FormControl>
                      <Input placeholder="Rahul Sharma" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="phoneNumber"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Phone Number</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Phone className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input placeholder="+91 9876543210" className="pl-10" {...field} />
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email Address</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input placeholder="rahul@email.com" className="pl-10" {...field} />
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
                    <FormLabel>Password</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input type="password" placeholder="••••••••" className="pl-10" {...field} />
                      </div>
                    </FormControl>
                    <PasswordStrength password={field.value} />
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="confirmPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Confirm Password</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input type="password" placeholder="••••••••" className="pl-10" {...field} />
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </motion.div>
          )}

          {/* Step 2: Professional Info */}
          {currentStep === 1 && (
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-4"
            >
              <h2 className="text-xl font-semibold flex items-center gap-2">
                <FileText className="h-5 w-5 text-success" />
                Professional Information
              </h2>

              <FormField
                control={form.control}
                name="githubUrl"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>GitHub Profile URL</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Github className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input placeholder="https://github.com/username" className="pl-10" {...field} />
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="linkedinUrl"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>LinkedIn Profile URL</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Linkedin className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input placeholder="https://linkedin.com/in/username" className="pl-10" {...field} />
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Resume status */}
              {resumeFile && (
                <div className="p-4 rounded-lg bg-muted/50 border">
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-success" />
                    <span className="text-sm font-medium">Resume uploaded: {resumeFile.name}</span>
                  </div>
                  {extractedSkills.length > 0 && (
                    <p className="text-xs text-muted-foreground mt-1">
                      {extractedSkills.length} skills will be added to your profile
                    </p>
                  )}
                </div>
              )}

              {!resumeFile && (
                <div className="p-4 rounded-lg bg-destructive/10 border border-destructive/20">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="h-4 w-4 text-destructive" />
                    <span className="text-sm text-destructive">Please go back and upload your resume</span>
                  </div>
                </div>
              )}
            </motion.div>
          )}

          {/* Navigation Buttons */}
          <div className="flex items-center justify-between pt-4">
            {currentStep > 0 ? (
              <Button type="button" variant="outline" onClick={prevStep}>
                <ArrowLeft className="mr-2 h-4 w-4" />
                Previous
              </Button>
            ) : (
              <Button type="button" variant="ghost" asChild>
                <Link to="/register">
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Back
                </Link>
              </Button>
            )}

            {currentStep < steps.length - 1 ? (
              <Button type="button" onClick={nextStep} className="bg-success hover:bg-success/90" disabled={isParsingResume}>
                {isParsingResume ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    Next
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </>
                )}
              </Button>
            ) : (
              <Button type="submit" variant="hero" disabled={isLoading || !resumeFile} className="bg-success hover:bg-success/90">
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Creating Account...
                  </>
                ) : (
                  <>
                    Create Account
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </>
                )}
              </Button>
            )}
          </div>
        </form>
      </Form>

      <p className="text-center mt-6 text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link to="/login" className="text-primary hover:underline">
          Sign in
        </Link>
      </p>
    </GlassCard>
  );
}
