import { useState, useCallback, useEffect, useRef } from "react";
import { MiniTipTapEditor } from "@/components/creative-tools/MiniTipTapEditor";
import {
  DndContext,
  useSensor,
  useSensors,
  PointerSensor,
  DragEndEvent,
  DragMoveEvent,
  useDndMonitor,
} from "@dnd-kit/core";
import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { Plus, Link2, Settings, X, Trash2, Users } from "lucide-react";
import { RelationshipTypesModal, type RelationshipType } from "./RelationshipTypesModal";
import { getCategoryColor, getCategoryLabel, stripHtml, type WorldBuildingCategory } from "@/lib/creative-tools-utils";
import { CreativeAITextField } from "@/components/CreativeAITextField";

export interface Character {
  id: string;
  name: string;
  description: string;
  traits: string[];
  category_id: string | null;
  position: { x: number; y: number };
}

export interface Relationship {
  id: string;
  from_id: string;
  to_id: string;
  type_id: string;
  notes: string;
}

export interface CharactersData {
  characters: Character[];
  relationshipTypes: RelationshipType[];
  relationships: Relationship[];
}

const DEFAULT_RELATIONSHIP_TYPES: RelationshipType[] = [
  { id: "rt-family", label: "Family", color: "#ef4444" },
  { id: "rt-friend", label: "Friend", color: "#22c55e" },
  { id: "rt-enemy", label: "Enemy", color: "#f97316" },
  { id: "rt-ally", label: "Ally", color: "#3b82f6" },
  { id: "rt-mentor", label: "Mentor", color: "#a855f7" },
];

function seedIfEmpty(data: CharactersData): CharactersData {
  if (data.relationshipTypes?.length || data.characters?.length) return data;
  return {
    characters: data.characters ?? [],
    relationships: data.relationships ?? [],
    relationshipTypes: DEFAULT_RELATIONSHIP_TYPES,
  };
}

interface Props {
  data: CharactersData;
  save: (d: CharactersData) => void;
  loading: boolean;
  worldCategories: WorldBuildingCategory[];
  onCharacterDeleted: (charId: string) => void;
}

/* ---------- Draggable card wrapper ---------- */
function DraggableCard({
  character,
  worldCategories,
  disabled,
  selected,
  onClick,
}: {
  character: Character;
  worldCategories: WorldBuildingCategory[];
  disabled: boolean;
  selected: boolean;
  onClick: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: character.id,
    disabled,
  });

  const borderColor = getCategoryColor(worldCategories, character.category_id);

  const style: React.CSSProperties = {
    position: "absolute",
    left: character.position.x,
    top: character.position.y,
    transform: CSS.Translate.toString(transform),
    zIndex: isDragging ? 50 : 1,
    opacity: isDragging ? 0.8 : 1,
    cursor: disabled ? "pointer" : "grab",
    width: 180,
    borderColor,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...(disabled ? {} : { ...attributes, ...listeners })}
      onClick={(e) => {
        if (!isDragging) {
          e.stopPropagation();
          onClick();
        }
      }}
    className={`rounded-lg border-2 bg-card p-3 shadow-sm select-none transition-shadow hover:shadow-md ${
        selected ? "ring-2 ring-primary ring-offset-2" : ""
      }`}
    >
      <p className="text-sm font-medium text-foreground truncate">{character.name || "Unnamed"}</p>
      {character.description && (
        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{stripHtml(character.description)}</p>
      )}
      {character.traits.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {character.traits.slice(0, 3).map((t) => (
            <Badge key={t} variant="secondary" className="text-[10px] px-1.5 py-0">
              {t}
            </Badge>
          ))}
          {character.traits.length > 3 && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0">
              +{character.traits.length - 3}
            </Badge>
          )}
        </div>
      )}
      {character.category_id && (
        <p className="text-[10px] mt-1.5" style={{ color: borderColor }}>
          {getCategoryLabel(worldCategories, character.category_id)}
        </p>
      )}
    </div>
  );
}

/* ---------- SVG relationship lines ---------- */
function RelationshipLines({
  characters,
  relationships,
  relationshipTypes,
  activeDragId,
  activeDragDelta,
  onLineClick,
}: {
  characters: Character[];
  relationships: Relationship[];
  relationshipTypes: RelationshipType[];
  activeDragId: string | null;
  activeDragDelta: { x: number; y: number };
  onLineClick: (relId: string, midX: number, midY: number) => void;
}) {
  const CARD_W = 180;
  const CARD_H = 80;

  const getCenter = (charId: string) => {
    const c = characters.find((ch) => ch.id === charId);
    if (!c) return { x: 0, y: 0 };
    let cx = c.position.x + CARD_W / 2;
    let cy = c.position.y + CARD_H / 2;
    if (charId === activeDragId) {
      cx += activeDragDelta.x;
      cy += activeDragDelta.y;
    }
    return { x: cx, y: cy };
  };

  // Group by pair to offset multiples
  const pairCounts: Record<string, number> = {};
  const pairIndex: Record<string, number> = {};

  relationships.forEach((r) => {
    const key = [r.from_id, r.to_id].sort().join("|");
    pairCounts[key] = (pairCounts[key] || 0) + 1;
  });

  return (
    <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ zIndex: 0 }}>
      {relationships.map((r) => {
        const from = getCenter(r.from_id);
        const to = getCenter(r.to_id);
        const type = relationshipTypes.find((t) => t.id === r.type_id);
        const color = type?.color ?? "#94a3b8";
        const key = [r.from_id, r.to_id].sort().join("|");
        const idx = pairIndex[key] ?? 0;
        pairIndex[key] = idx + 1;
        const total = pairCounts[key] ?? 1;
        const offset = (idx - (total - 1) / 2) * 8;

        // Perpendicular offset
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        const nx = -dy / len;
        const ny = dx / len;

        const x1 = from.x + nx * offset;
        const y1 = from.y + ny * offset;
        const x2 = to.x + nx * offset;
        const y2 = to.y + ny * offset;
        const midX = (x1 + x2) / 2;
        const midY = (y1 + y2) / 2;

        return (
          <g key={r.id}>
            <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth={2} strokeOpacity={0.6} />
            {/* Clickable area */}
            <line
              x1={x1} y1={y1} x2={x2} y2={y2}
              stroke="transparent" strokeWidth={16}
              className="pointer-events-auto cursor-pointer"
              onClick={() => onLineClick(r.id, midX, midY)}
            />
            {type && (
              <text
                x={midX} y={midY - 6}
                textAnchor="middle"
                fill={color}
                fontSize={10}
                fontWeight={500}
                className="pointer-events-none select-none"
              >
                {type.label}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

/* ---------- Main component ---------- */
export function CharactersDiagram({ data: rawData, save, loading, worldCategories, onCharacterDeleted }: Props) {
  const data = seedIfEmpty({
    characters: rawData.characters ?? [],
    relationshipTypes: rawData.relationshipTypes ?? [],
    relationships: rawData.relationships ?? [],
  });

  const [editChar, setEditChar] = useState<Character | null>(null);
  const [showRelTypes, setShowRelTypes] = useState(false);
  const [relMode, setRelMode] = useState(false);
  const [relSource, setRelSource] = useState<string | null>(null);
  const [relPickerOpen, setRelPickerOpen] = useState(false);
  const [relTarget, setRelTarget] = useState<string | null>(null);
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [activeDragDelta, setActiveDragDelta] = useState({ x: 0, y: 0 });
  const [selectedRelId, setSelectedRelId] = useState<string | null>(null);
  const [relPopoverPos, setRelPopoverPos] = useState({ x: 0, y: 0 });
  const [traitInput, setTraitInput] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [filterCategories, setFilterCategories] = useState<string[]>([]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  // Escape key handler for relationship mode
  useEffect(() => {
    if (!relMode) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setRelMode(false);
        setRelSource(null);
        setRelTarget(null);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [relMode]);

  const latestDataRef = useRef(data);
  latestDataRef.current = data;

  const updateData = useCallback(
    (updater: (d: CharactersData) => CharactersData) => {
      save(updater(latestDataRef.current));
    },
    [save]
  );

  const handleAddCharacter = () => {
    const newChar: Character = {
      id: crypto.randomUUID(),
      name: "New Character",
      description: "",
      traits: [],
      category_id: null,
      position: { x: 50 + Math.random() * 200, y: 50 + Math.random() * 200 },
    };
    updateData((d) => ({ ...d, characters: [...d.characters, newChar] }));
    setEditChar(newChar);
  };

  const handleDragMove = (event: DragMoveEvent) => {
    setActiveDragId(event.active.id as string);
    setActiveDragDelta({ x: event.delta.x, y: event.delta.y });
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, delta } = event;
    setActiveDragId(null);
    setActiveDragDelta({ x: 0, y: 0 });
    updateData((d) => ({
      ...d,
      characters: d.characters.map((c) =>
        c.id === active.id
          ? { ...c, position: { x: Math.max(0, c.position.x + delta.x), y: Math.max(0, c.position.y + delta.y) } }
          : c
      ),
    }));
  };

  const handleCardClick = (charId: string) => {
    if (relMode) {
      if (!relSource) {
        setRelSource(charId);
      } else if (charId !== relSource) {
        setRelTarget(charId);
        setRelPickerOpen(true);
      }
      return;
    }
    const char = data.characters.find((c) => c.id === charId);
    if (char) setEditChar({ ...char });
  };

  const handleCreateRelationship = (typeId: string) => {
    if (!relSource || !relTarget) return;
    const newRel: Relationship = {
      id: crypto.randomUUID(),
      from_id: relSource,
      to_id: relTarget,
      type_id: typeId,
      notes: "",
    };
    updateData((d) => ({ ...d, relationships: [...d.relationships, newRel] }));
    setRelMode(false);
    setRelSource(null);
    setRelTarget(null);
    setRelPickerOpen(false);
  };

  const handleSaveChar = () => {
    if (!editChar) return;
    updateData((d) => ({
      ...d,
      characters: d.characters.map((c) => (c.id === editChar.id ? editChar : c)),
    }));
    setEditChar(null);
  };

  const handleDeleteChar = (charId: string) => {
    updateData((d) => ({
      ...d,
      characters: d.characters.filter((c) => c.id !== charId),
      relationships: d.relationships.filter((r) => r.from_id !== charId && r.to_id !== charId),
    }));
    onCharacterDeleted(charId);
    setEditChar(null);
    setDeleteConfirm(null);
  };

  const handleRelTypesUpdate = (types: RelationshipType[]) => {
    const removedIds = new Set(
      data.relationshipTypes.filter((t) => !types.find((nt) => nt.id === t.id)).map((t) => t.id)
    );
    updateData((d) => ({
      ...d,
      relationshipTypes: types,
      relationships: removedIds.size > 0
        ? d.relationships.filter((r) => !removedIds.has(r.type_id))
        : d.relationships,
    }));
  };

  const handleLineClick = (relId: string, midX: number, midY: number) => {
    setSelectedRelId(relId);
    setRelPopoverPos({ x: midX, y: midY });
  };

  const handleDeleteRelationship = (relId: string) => {
    updateData((d) => ({
      ...d,
      relationships: d.relationships.filter((r) => r.id !== relId),
    }));
    setSelectedRelId(null);
  };

  const filteredCharacters = filterCategories.length > 0
    ? data.characters.filter((c) => c.category_id && filterCategories.includes(c.category_id))
    : data.characters;

  const filteredCharIds = new Set(filteredCharacters.map((c) => c.id));
  const filteredRelationships = data.relationships.filter(
    (r) => filteredCharIds.has(r.from_id) && filteredCharIds.has(r.to_id)
  );

  const selectedRel = data.relationships.find((r) => r.id === selectedRelId);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground">Loading characters…</p>
      </div>
    );
  }

  if (data.characters.length === 0) {
    return (
      <div className="flex-1 flex flex-col bg-background">
        <div className="h-10 border-b border-border flex items-center gap-2 px-4 shrink-0">
          <Button size="sm" className="h-7 gap-1.5 text-xs" onClick={handleAddCharacter}>
            <Plus className="h-3.5 w-3.5" /> Add Character
          </Button>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-3">
            <Users className="h-10 w-10 text-muted-foreground mx-auto" />
            <p className="text-sm font-medium text-foreground">No characters yet</p>
            <p className="text-xs text-muted-foreground">Click "Add Character" to start building your cast.</p>
            {worldCategories.length === 0 && (
              <p className="text-xs text-muted-foreground/70">
                Tip: Add categories in World-Building to color-code characters.
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-background overflow-hidden">
      {/* Toolbar */}
      <div className="h-10 border-b border-border flex items-center gap-2 px-4 shrink-0">
        <Button size="sm" className="h-7 gap-1.5 text-xs" onClick={handleAddCharacter}>
          <Plus className="h-3.5 w-3.5" /> Add Character
        </Button>
        <Button
          size="sm"
          variant={relMode ? "default" : "outline"}
          className="h-7 gap-1.5 text-xs"
          onClick={() => {
            setRelMode(!relMode);
            setRelSource(null);
            setRelTarget(null);
          }}
        >
          <Link2 className="h-3.5 w-3.5" /> {relMode ? "Cancel" : "Add Relationship"}
        </Button>
        <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs" onClick={() => setShowRelTypes(true)}>
          <Settings className="h-3.5 w-3.5" /> Types
        </Button>
        {worldCategories.length > 0 && (
          <Select
            value={filterCategories.length === 0 ? "__all" : filterCategories[0]}
            onValueChange={(v) => setFilterCategories(v === "__all" ? [] : [v])}
          >
            <SelectTrigger className="h-7 w-[140px] text-xs">
              <SelectValue placeholder="All categories" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all">All categories</SelectItem>
              {worldCategories.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: c.color }} />
                    {c.name}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Relationship mode banner */}
      {relMode && (
        <div className="h-8 bg-primary/10 border-b border-primary/20 flex items-center justify-center gap-2 px-4 shrink-0">
          <span className="text-xs text-primary font-medium">
            {!relSource
              ? "Click the first character…"
              : "Now click the second character to create a relationship."}
          </span>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 text-xs text-primary"
            onClick={() => {
              setRelMode(false);
              setRelSource(null);
            }}
          >
            <X className="h-3 w-3 mr-1" /> Cancel
          </Button>
        </div>
      )}

      {/* Canvas */}
      <DndContext sensors={relMode ? undefined : sensors} onDragMove={handleDragMove} onDragEnd={handleDragEnd}>
        <div className="flex-1 relative overflow-auto">
          <RelationshipLines
            characters={filteredCharacters}
            relationships={filteredRelationships}
            relationshipTypes={data.relationshipTypes}
            activeDragId={activeDragId}
            activeDragDelta={activeDragDelta}
            onLineClick={handleLineClick}
          />
          {filteredCharacters.map((c) => (
            <DraggableCard
              key={c.id}
              character={c}
              worldCategories={worldCategories}
              disabled={relMode}
              selected={relMode && relSource === c.id}
              onClick={() => handleCardClick(c.id)}
            />
          ))}

          {/* Relationship popover — positioned absolutely */}
          {selectedRel && (
            <div
              className="absolute z-50"
              style={{ left: relPopoverPos.x - 100, top: relPopoverPos.y + 10 }}
            >
              <div className="bg-popover border rounded-lg shadow-lg p-3 w-[200px]">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium">
                    {data.relationshipTypes.find((t) => t.id === selectedRel.type_id)?.label ?? "Unknown"}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => setSelectedRelId(null)}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground mb-2">
                  {data.characters.find((c) => c.id === selectedRel.from_id)?.name ?? "?"} →{" "}
                  {data.characters.find((c) => c.id === selectedRel.to_id)?.name ?? "?"}
                </p>
                {selectedRel.notes && (
                  <p className="text-xs text-muted-foreground mb-2 italic">{selectedRel.notes}</p>
                )}
                <Button
                  variant="destructive"
                  size="sm"
                  className="h-6 text-xs w-full"
                  onClick={() => handleDeleteRelationship(selectedRel.id)}
                >
                  <Trash2 className="h-3 w-3 mr-1" /> Delete
                </Button>
              </div>
            </div>
          )}
        </div>
      </DndContext>

      {/* Relationship type picker dialog */}
      <Dialog open={relPickerOpen} onOpenChange={(o) => { if (!o) { setRelPickerOpen(false); setRelTarget(null); } }}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle className="text-sm">Choose relationship type</DialogTitle>
          </DialogHeader>
          <div className="space-y-1">
            {data.relationshipTypes.map((t) => (
              <button
                key={t.id}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm hover:bg-accent transition-colors"
                onClick={() => handleCreateRelationship(t.id)}
              >
                <span className="w-3 h-3 rounded-full" style={{ backgroundColor: t.color }} />
                {t.label}
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit character dialog */}
      <Dialog open={!!editChar} onOpenChange={(o) => { if (!o) handleSaveChar(); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Character</DialogTitle>
          </DialogHeader>
          {editChar && (
            <div className="space-y-4">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Name</label>
                <Input
                  value={editChar.name}
                  onChange={(e) => setEditChar({ ...editChar, name: e.target.value })}
                  className="mt-1"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Description</label>
                <CreativeAITextField sourceModule="character_chart">
                  <MiniTipTapEditor
                    value={editChar.description}
                    onChange={(html) => setEditChar({ ...editChar, description: html })}
                    className="min-h-[80px]"
                    placeholder="Describe this character…"
                  />
                </CreativeAITextField>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Category</label>
                <Select
                  value={editChar.category_id ?? "__none"}
                  onValueChange={(v) => setEditChar({ ...editChar, category_id: v === "__none" ? null : v })}
                >
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">None</SelectItem>
                    {worldCategories.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        <span className="flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: c.color }} />
                          {c.name}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Traits</label>
                <div className="flex flex-wrap gap-1 mt-1 mb-2">
                  {editChar.traits.map((t, i) => (
                    <Badge key={i} variant="secondary" className="text-xs gap-1">
                      {t}
                      <button
                        onClick={() =>
                          setEditChar({
                            ...editChar,
                            traits: editChar.traits.filter((_, j) => j !== i),
                          })
                        }
                        className="hover:text-destructive"
                      >
                        <X className="h-2.5 w-2.5" />
                      </button>
                    </Badge>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Input
                    placeholder="Add trait and press Enter"
                    value={traitInput}
                    onChange={(e) => setTraitInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && traitInput.trim()) {
                        setEditChar({
                          ...editChar,
                          traits: [...editChar.traits, traitInput.trim()],
                        });
                        setTraitInput("");
                      }
                    }}
                    className="flex-1 h-8 text-sm"
                  />
                </div>
              </div>
              <div className="flex justify-between pt-2 border-t border-border">
                {deleteConfirm === editChar.id ? (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-destructive">Delete this character?</span>
                    <Button size="sm" variant="destructive" className="h-7 text-xs" onClick={() => handleDeleteChar(editChar.id)}>
                      Yes, delete
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setDeleteConfirm(null)}>
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive" onClick={() => setDeleteConfirm(editChar.id)}>
                    <Trash2 className="h-3.5 w-3.5 mr-1" /> Delete
                  </Button>
                )}
                <Button size="sm" onClick={handleSaveChar}>Save</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <RelationshipTypesModal
        open={showRelTypes}
        onOpenChange={setShowRelTypes}
        types={data.relationshipTypes}
        onSave={handleRelTypesUpdate}
      />
    </div>
  );
}
