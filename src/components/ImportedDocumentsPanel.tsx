import { useState, useRef } from "react";
import { FileUp, FileText, Trash2, X, Loader2, File } from "lucide-react";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import type { ImportedDocument } from "@/hooks/useImportedDocuments";

interface Props {
  documents: ImportedDocument[];
  loading: boolean;
  uploading: boolean;
  onUpload: (file: File) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

function formatFileSize(bytes: number | null): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const FILE_ICONS: Record<string, string> = {
  pdf: "📄",
  txt: "📝",
  md: "📝",
  docx: "📃",
};

export function ImportedDocumentsPanel({ documents, loading, uploading, onUpload, onDelete, onClose }: Props) {
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onUpload(file);
      // Reset input so same file can be re-uploaded
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-background">
      {/* Header */}
      <div className="h-10 border-b border-border flex items-center justify-between px-4 shrink-0 bg-[hsl(var(--ethos-surface))]">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium text-foreground">Project Documents</span>
          <span className="text-xs text-muted-foreground">({documents.length})</span>
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.txt,.md,.docx"
            className="hidden"
            onChange={handleFileSelect}
          />
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 text-xs"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Processing…
              </>
            ) : (
              <>
                <FileUp className="h-3.5 w-3.5" />
                Import
              </>
            )}
          </Button>
          <button
            onClick={onClose}
            className="p-1 text-muted-foreground hover:text-foreground transition-colors rounded-md"
            aria-label="Close documents panel"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : documents.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <File className="h-10 w-10 text-muted-foreground/40 mb-3" />
            <p className="text-sm text-muted-foreground mb-1">No documents imported</p>
            <p className="text-xs text-muted-foreground/60 max-w-[250px]">
              Import PDF, TXT, MD, or DOCX files to use as reference material in your chat conversations.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-4 gap-1.5"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
            >
              <FileUp className="h-3.5 w-3.5" />
              Import your first document
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            {documents.map((doc) => {
              const ext = doc.file_name.split(".").pop()?.toLowerCase() ?? "";
              const icon = FILE_ICONS[ext] ?? "📄";
              const isProcessing = !doc.extracted_text && !doc.summary;

              return (
                <div
                  key={doc.id}
                  className="flex items-start gap-3 p-3 rounded-lg border border-border bg-card hover:bg-accent/5 transition-colors"
                >
                  <span className="text-lg mt-0.5">{icon}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{doc.file_name}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs text-muted-foreground">{formatFileSize(doc.file_size_bytes)}</span>
                      <span className="text-xs text-muted-foreground">·</span>
                      <span className="text-xs text-muted-foreground">
                        {format(new Date(doc.uploaded_at), "MMM d, yyyy")}
                      </span>
                    </div>
                    {isProcessing ? (
                      <div className="flex items-center gap-1.5 mt-1.5">
                        <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                        <span className="text-xs text-muted-foreground">Processing…</span>
                      </div>
                    ) : doc.summary ? (
                      <p className="text-xs text-muted-foreground/80 mt-1.5 line-clamp-2">{doc.summary}</p>
                    ) : null}
                  </div>
                  <div className="shrink-0">
                    {confirmDelete === doc.id ? (
                      <div className="flex items-center gap-1">
                        <Button
                          variant="destructive"
                          size="sm"
                          className="h-6 text-xs px-2"
                          onClick={() => {
                            onDelete(doc.id);
                            setConfirmDelete(null);
                          }}
                        >
                          Delete
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 text-xs px-2"
                          onClick={() => setConfirmDelete(null)}
                        >
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setConfirmDelete(doc.id)}
                        className="p-1 text-muted-foreground hover:text-destructive transition-colors rounded-md opacity-0 group-hover:opacity-100 hover:opacity-100"
                        style={{ opacity: undefined }}
                        aria-label="Delete document"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Supported formats note */}
        {documents.length > 0 && (
          <p className="text-[10px] text-muted-foreground/50 mt-4 text-center">
            Supported: PDF, TXT, MD, DOCX · Max 10MB
          </p>
        )}
      </div>
    </div>
  );
}
