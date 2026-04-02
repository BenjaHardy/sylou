import { useState, useCallback, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

export interface ImportedDocument {
  id: string;
  project_id: string;
  file_name: string;
  file_path: string;
  extracted_text: string | null;
  summary: string | null;
  file_size_bytes: number | null;
  uploaded_at: string;
}

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_EXTENSIONS = ["pdf", "txt", "md", "docx"];

export function useImportedDocuments(projectId: string | null) {
  const [documents, setDocuments] = useState<ImportedDocument[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);

  const fetchDocuments = useCallback(async () => {
    if (!projectId) {
      setDocuments([]);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from("imported_documents")
      .select("*")
      .eq("project_id", projectId)
      .order("uploaded_at", { ascending: false });

    if (error) {
      console.error("Failed to load documents:", error);
    }
    setDocuments((data as ImportedDocument[]) ?? []);
    setLoading(false);
  }, [projectId]);

  useEffect(() => {
    fetchDocuments();
  }, [fetchDocuments]);

  const uploadDocument = useCallback(
    async (file: File) => {
      if (!projectId) return;

      // Validate
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
      if (!ALLOWED_EXTENSIONS.includes(ext)) {
        toast({
          title: "Unsupported file type",
          description: `Only ${ALLOWED_EXTENSIONS.join(", ")} files are supported.`,
          variant: "destructive",
        });
        return;
      }
      if (file.size > MAX_FILE_SIZE) {
        toast({
          title: "File too large",
          description: "Maximum file size is 10MB.",
          variant: "destructive",
        });
        return;
      }

      setUploading(true);
      try {
        // Get user
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) throw new Error("Not authenticated");

        // Handle duplicate file names
        const timestamp = Date.now();
        const existingNames = documents.map((d) => d.file_name);
        let fileName = file.name;
        if (existingNames.includes(fileName)) {
          const nameWithoutExt = fileName.slice(0, -(ext.length + 1));
          fileName = `${nameWithoutExt}_${timestamp}.${ext}`;
        }

        const storagePath = `${user.id}/${projectId}/${fileName}`;

        // Upload to storage
        const { error: uploadErr } = await supabase.storage
          .from("imports")
          .upload(storagePath, file);

        if (uploadErr) {
          console.error("Storage upload error:", uploadErr);
          toast({
            title: "Upload failed",
            description: uploadErr.message,
            variant: "destructive",
          });
          setUploading(false);
          return;
        }

        // Insert document row (without extracted_text/summary yet)
        const { data: docRow, error: insertErr } = await supabase
          .from("imported_documents")
          .insert({
            project_id: projectId,
            file_name: fileName,
            file_path: storagePath,
            file_size_bytes: file.size,
          })
          .select()
          .single();

        if (insertErr || !docRow) {
          console.error("Document insert error:", insertErr);
          toast({
            title: "Failed to save document",
            description: insertErr?.message ?? "Unknown error",
            variant: "destructive",
          });
          setUploading(false);
          return;
        }

        // Call extract-text edge function
        const {
          data: { session },
        } = await supabase.auth.getSession();

        const extractRes = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/extract-text`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${session?.access_token}`,
              apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            },
            body: JSON.stringify({
              file_path: storagePath,
              project_id: projectId,
              document_id: docRow.id,
            }),
          }
        );

        if (!extractRes.ok) {
          const errBody = await extractRes.text();
          console.error("Extract-text error:", errBody);
          toast({
            title: "Text extraction failed",
            description: "The document was uploaded but text extraction failed. You can try deleting and re-uploading.",
            variant: "destructive",
          });
        } else {
          toast({
            title: "Document imported",
            description: `${fileName} has been processed and is ready for use.`,
          });
        }

        // Refresh list
        await fetchDocuments();
      } catch (err) {
        console.error("Upload error:", err);
        toast({
          title: "Upload failed",
          description: err instanceof Error ? err.message : "Unknown error",
          variant: "destructive",
        });
      } finally {
        setUploading(false);
      }
    },
    [projectId, documents, fetchDocuments]
  );

  const deleteDocument = useCallback(
    async (docId: string) => {
      const doc = documents.find((d) => d.id === docId);
      if (!doc) return;

      // Delete from storage
      const { error: storageErr } = await supabase.storage
        .from("imports")
        .remove([doc.file_path]);

      if (storageErr) {
        console.error("Storage delete error:", storageErr);
      }

      // Delete from DB
      const { error: dbErr } = await supabase
        .from("imported_documents")
        .delete()
        .eq("id", docId);

      if (dbErr) {
        console.error("DB delete error:", dbErr);
        toast({
          title: "Failed to delete document",
          description: dbErr.message,
          variant: "destructive",
        });
        return;
      }

      setDocuments((prev) => prev.filter((d) => d.id !== docId));
      toast({ title: "Document deleted" });
    },
    [documents]
  );

  return {
    documents,
    loading,
    uploading,
    uploadDocument,
    deleteDocument,
    refreshDocuments: fetchDocuments,
  };
}
