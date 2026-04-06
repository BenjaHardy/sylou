import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Trash2, Plus } from "lucide-react";

export interface RelationshipType {
  id: string;
  label: string;
  color: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  types: RelationshipType[];
  onSave: (types: RelationshipType[]) => void;
}

export function RelationshipTypesModal({ open, onOpenChange, types, onSave }: Props) {
  const [local, setLocal] = useState<RelationshipType[]>(types);
  const [newLabel, setNewLabel] = useState("");
  const [newColor, setNewColor] = useState("#6366f1");

  const handleAdd = () => {
    const label = newLabel.trim();
    if (!label) return;
    setLocal([...local, { id: crypto.randomUUID(), label, color: newColor }]);
    setNewLabel("");
    setNewColor("#6366f1");
  };

  const handleDelete = (id: string) => {
    setLocal(local.filter((t) => t.id !== id));
  };

  const handleUpdate = (id: string, field: "label" | "color", value: string) => {
    setLocal(local.map((t) => (t.id === id ? { ...t, [field]: value } : t)));
  };

  const handleSave = () => {
    onSave(local);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Relationship Types</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 max-h-[300px] overflow-y-auto">
          {local.map((t) => (
            <div key={t.id} className="flex items-center gap-2">
              <input
                type="color"
                value={t.color}
                onChange={(e) => handleUpdate(t.id, "color", e.target.value)}
                className="w-8 h-8 rounded cursor-pointer border-0 p-0"
              />
              <Input
                value={t.label}
                onChange={(e) => handleUpdate(t.id, "label", e.target.value)}
                className="flex-1 h-8 text-sm"
              />
              <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleDelete(t.id)}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2 pt-2 border-t border-border">
          <input
            type="color"
            value={newColor}
            onChange={(e) => setNewColor(e.target.value)}
            className="w-8 h-8 rounded cursor-pointer border-0 p-0"
          />
          <Input
            placeholder="New type name…"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            className="flex-1 h-8 text-sm"
          />
          <Button variant="outline" size="sm" className="h-8" onClick={handleAdd}>
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button size="sm" onClick={handleSave}>Save</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
