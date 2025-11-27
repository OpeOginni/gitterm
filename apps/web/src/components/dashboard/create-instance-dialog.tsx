"use client";

import { useState, useEffect } from "react";
import { queryClient, trpc } from "@/utils/trpc";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import Image from "next/image";
import { useMutation, useQuery } from "@tanstack/react-query";

const ICON_MAP: Record<string, string> = {
  "opencode": "/opencode.svg",
  "railway": "/railway.svg",
  "aws": "/EC2.svg",
  "claude": "/code.svg", 
};

const getIcon = (name: string) => {
  const key = name.toLowerCase();
  for (const [k, v] of Object.entries(ICON_MAP)) {
    if (key.includes(k)) return v;
  }
  return "/opencode.svg"; // default
};

export function CreateInstanceDialog() {
  const [open, setOpen] = useState(false);
  const [repoUrl, setRepoUrl] = useState("");
  const [selectedAgentTypeId, setSelectedAgentTypeId] = useState<string>("");
  const [selectedCloudProviderId, setSelectedCloudProviderId] = useState<string>("");
  const [selectedImageId, setSelectedImageId] = useState<string>("");
  const [selectedRegion, setSelectedRegion] = useState("us-west-1");

  // Fetch dynamic data
  const { data: agentTypesData } = useQuery(trpc.workspace.listAgentTypes.queryOptions());
  const { data: cloudProvidersData } = useQuery(trpc.workspace.listCloudProviders.queryOptions());
  
  // Fetch images when agent type changes
  const { data: imagesData } = useQuery(
    trpc.workspace.listImages.queryOptions(
      { agentTypeId: selectedAgentTypeId },
      { enabled: !!selectedAgentTypeId }
    )
  );

  // Set defaults when data loads
  useEffect(() => {
    if (agentTypesData?.agentTypes?.[0] && !selectedAgentTypeId) {
      setSelectedAgentTypeId(agentTypesData.agentTypes[0].id);
    }
  }, [agentTypesData, selectedAgentTypeId]);

  useEffect(() => {
    if (cloudProvidersData?.cloudProviders?.[0] && !selectedCloudProviderId) {
      setSelectedCloudProviderId(cloudProvidersData.cloudProviders[0].id);
    }
  }, [cloudProvidersData, selectedCloudProviderId]);

  useEffect(() => {
    if (imagesData?.images?.[0]) {
      setSelectedImageId(imagesData.images[0].id);
    }
  }, [imagesData]);

  const createServiceMutation = useMutation(trpc.railway.createService.mutationOptions({
    onSuccess: () => {
      toast.success("Instance creation started");
      setOpen(false);
      queryClient.invalidateQueries(trpc.workspace.listWorkspaces.queryOptions());
    },
    onError: (error) => {
      console.error(error);
      toast.error(`Failed to create instance: ${error.message}`);
    },
  }));

  const handleSubmit = async () => {
    if (!selectedAgentTypeId || !selectedCloudProviderId || !selectedImageId) {
      toast.error("Please select an agent, cloud provider, and image.");
      return;
    }

    const result = await createServiceMutation.mutateAsync({
      repo: repoUrl,
      imageId: selectedImageId,
      agentTypeId: selectedAgentTypeId,
      cloudProviderId: selectedCloudProviderId,
      region: selectedRegion,
      name: repoUrl.split("/").pop() || "new-workspace",
    });

    window.location.href = `https://${result.workspace.subdomain}.gitterm.dev`;
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-2 h-4 w-4" /> New Instance
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[525px]">
        <DialogHeader>
          <DialogTitle>Create New Instance</DialogTitle>
          <DialogDescription>
            Deploy a new development workspace from a GitHub repository.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="repo">GitHub Repository URL</Label>
            <Input
              id="repo"
              placeholder="https://github.com/username/repo"
              value={repoUrl}
              onChange={(e) => setRepoUrl(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label>Agent Type</Label>
              <Select value={selectedAgentTypeId} onValueChange={setSelectedAgentTypeId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select agent" />
                </SelectTrigger>
                <SelectContent>
                  {agentTypesData?.agentTypes?.map((agent) => (
                    <SelectItem key={agent.id} value={agent.id}>
                      <div className="flex items-center">
                        <Image 
                          src={getIcon(agent.name)} 
                          alt={agent.name} 
                          width={16} 
                          height={16} 
                          className="mr-2 h-4 w-4" 
                        />
                        {agent.name}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label>Cloud Provider</Label>
              <Select value={selectedCloudProviderId} onValueChange={setSelectedCloudProviderId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select cloud" />
                </SelectTrigger>
                <SelectContent>
                  {cloudProvidersData?.cloudProviders?.map((cloud) => (
                    <SelectItem key={cloud.id} value={cloud.id}>
                      <div className="flex items-center">
                        <Image 
                          src={getIcon(cloud.name)} 
                          alt={cloud.name} 
                          width={16} 
                          height={16} 
                          className="mr-2 h-4 w-4" 
                        />
                        {cloud.name}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          
           {/* Optional Image Selection if multiple images exist */}
           {imagesData?.images && imagesData.images.length > 1 && (
            <div className="grid gap-2">
              <Label>Docker Image</Label>
              <Select value={selectedImageId} onValueChange={setSelectedImageId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select image" />
                </SelectTrigger>
                <SelectContent>
                  {imagesData.images.map((img) => (
                    <SelectItem key={img.id} value={img.id}>
                      {img.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="grid gap-2">
            <Label>Region</Label>
             <Select value={selectedRegion} onValueChange={setSelectedRegion}>
                <SelectTrigger>
                  <SelectValue placeholder="Select region" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="us-west-1">US West (Oregon)</SelectItem>
                  <SelectItem value="us-east-1">US East (N. Virginia)</SelectItem>
                  <SelectItem value="eu-central-1">Europe (Frankfurt)</SelectItem>
                </SelectContent>
              </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!repoUrl || createServiceMutation.isPending || !selectedAgentTypeId}>
            {createServiceMutation.isPending && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            Create Instance
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
