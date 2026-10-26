import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Home, Loader2, MapPin, Plus } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import LocationSearch from "@/components/LocationSearch";
import {
  addressLine,
  addressUsable,
  blankAddress,
  fromPlace,
  labelTaken,
  listAddresses,
  removeAddress,
  saveAddress,
  type AddressFields,
  type SavedAddress,
} from "@/lib/addressBook";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "@/hooks/use-toast";

const fieldLabel = "text-smoke text-xs tracking-[0.2em] uppercase block text-left mb-2";

/**
 * The member's saved addresses.
 *
 * Every booking used to start by typing an address that had not changed since
 * the last one. What is kept here is offered on the booking form, so a
 * journey home is two taps rather than four fields.
 */
const AddressBook = () => {
  const { user, profile } = useAuth();
  const queryClient = useQueryClient();

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<SavedAddress | null>(null);
  const [label, setLabel] = useState("");
  const [fields, setFields] = useState<AddressFields>(blankAddress());
  const [isHome, setIsHome] = useState(false);

  const { data: addresses, isLoading, error } = useQuery({
    queryKey: ["my-addresses", user?.id],
    queryFn: () => listAddresses(user!.id),
    enabled: !!user,
  });

  const book = addresses ?? [];
  const set = (part: Partial<AddressFields>) => setFields((f) => ({ ...f, ...part }));

  const start = (a?: SavedAddress, seed?: { label: string; fields: AddressFields; home: boolean }) => {
    setEditing(a ?? null);
    setLabel(a?.label ?? seed?.label ?? "");
    setFields(a ? { line1: a.line1, line2: a.line2, town: a.town, postcode: a.postcode, country: a.country } : seed?.fields ?? blankAddress());
    // The first address somebody saves is almost always their home one
    setIsHome(a ? a.is_home : seed?.home ?? book.length === 0);
    setOpen(true);
  };

  const save = useMutation({
    mutationFn: () =>
      saveAddress(user!.id, { id: editing?.id, label, is_home: isHome, ...fields }),
    onSuccess: () => {
      toast({
        title: editing ? "Address updated" : "Address saved",
        description: `${label.trim()} is ready to choose when you book.`,
      });
      setOpen(false);
      queryClient.invalidateQueries({ queryKey: ["my-addresses", user?.id] });
    },
    onError: (err: Error) =>
      toast({ title: "Could not save that", description: err.message, variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => removeAddress(user!.id, id),
    onSuccess: () => {
      toast({ title: "Address removed" });
      queryClient.invalidateQueries({ queryKey: ["my-addresses", user?.id] });
    },
    onError: (err: Error) =>
      toast({ title: "Could not remove that", description: err.message, variant: "destructive" }),
  });

  const taken = labelTaken(book, label, editing?.id);
  const ready = !!label.trim() && !taken && addressUsable(fields);

  /*
   * The profile already holds one address, which is almost always home, so
   * offer it rather than making somebody type it a second time.
   */
  const profileAddress = profile
    ? {
        line1: profile.address_line1 ?? "",
        line2: profile.address_line2 ?? "",
        town: profile.town ?? "",
        postcode: profile.postcode ?? "",
        country: "United Kingdom",
      }
    : null;
  const offerProfile =
    book.length === 0 && !!profileAddress && addressUsable(profileAddress);

  return (
    <div className="mt-16 pt-12 border-t border-border">
      <div className="flex items-end justify-between mb-6">
        <div className="text-left">
          <p className="text-champagne text-xs tracking-[0.4em] uppercase mb-2">Addresses</p>
          <h2 className="font-display text-2xl font-light tracking-wider text-foreground">
            Address Book
          </h2>
        </div>
        <Button variant="outline" onClick={() => start()} className="tracking-[0.15em] uppercase">
          <Plus className="w-4 h-4 mr-2" />
          Add
        </Button>
      </div>

      {error && (
        <p className="text-destructive text-sm text-left mb-4">
          We could not load your addresses: {(error as Error).message}
        </p>
      )}

      {isLoading && user ? (
        <Loader2 className="w-4 h-4 animate-spin text-champagne" />
      ) : book.length === 0 ? (
        <div className="text-left space-y-4">
          <p className="text-smoke text-sm font-light">
            Nothing saved yet. Keep the places you travel from and to, and they will be waiting
            for you on the booking form.
          </p>
          {offerProfile && (
            <Button
              variant="outline"
              onClick={() =>
                start(undefined, { label: "Home", fields: profileAddress!, home: true })
              }
              className="tracking-[0.15em] uppercase"
            >
              <Home className="w-4 h-4 mr-2" />
              Save my home address
            </Button>
          )}
        </div>
      ) : (
        <ul className="space-y-3">
          {book.map((a) => (
            <li
              key={a.id}
              className="flex items-start justify-between gap-4 border border-border px-4 py-3"
            >
              <div className="flex items-start gap-3 min-w-0 text-left">
                {a.is_home ? (
                  <Home className="w-4 h-4 text-champagne flex-none mt-1" />
                ) : (
                  <MapPin className="w-4 h-4 text-champagne flex-none mt-1" />
                )}
                <div className="min-w-0">
                  <div className="text-foreground text-sm flex items-center gap-2">
                    {a.label}
                    {a.is_home && <Badge variant="secondary">Home</Badge>}
                  </div>
                  <p className="text-smoke text-xs mt-0.5">{addressLine(a)}</p>
                </div>
              </div>
              <div className="flex items-center gap-1 flex-none">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => start(a)}
                  className="text-smoke tracking-[0.15em] uppercase"
                >
                  Edit
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={remove.isPending}
                      className="text-smoke hover:text-destructive tracking-[0.15em] uppercase"
                    >
                      Remove
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Remove {a.label}?</AlertDialogTitle>
                      <AlertDialogDescription>
                        It will no longer be offered when you book. Journeys already booked to or
                        from it are not affected.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Keep</AlertDialogCancel>
                      <AlertDialogAction onClick={() => remove.mutate(a.id)}>
                        Remove
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-display tracking-wider font-light">
              {editing ? "Edit Address" : "Add an Address"}
            </DialogTitle>
            <DialogDescription>
              Give it a name you will recognise on the booking form, such as Home, The office, or
              the airport you fly from.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (ready) save.mutate();
            }}
            className="space-y-4 mt-2"
          >
            <div>
              <label className={fieldLabel}>Name</label>
              <Input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Home"
                maxLength={60}
                required
              />
              {taken && (
                <p className="text-destructive text-xs mt-2 text-left">
                  You already have an address called that.
                </p>
              )}
            </div>

            <div>
              <label className={fieldLabel}>Search</label>
              <LocationSearch
                placeholder="Search a place, airport or postcode"
                onSelect={(s) => set(fromPlace(s))}
              />
            </div>

            <div>
              <label className={fieldLabel}>Address Line 1</label>
              <Input
                value={fields.line1}
                onChange={(e) => set({ line1: e.target.value })}
                maxLength={200}
              />
            </div>
            <div>
              <label className={fieldLabel}>Address Line 2</label>
              <Input
                value={fields.line2}
                onChange={(e) => set({ line2: e.target.value })}
                maxLength={200}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={fieldLabel}>Town / City</label>
                <Input
                  value={fields.town}
                  onChange={(e) => set({ town: e.target.value })}
                  maxLength={100}
                />
              </div>
              <div>
                <label className={fieldLabel}>Postcode</label>
                <Input
                  value={fields.postcode}
                  onChange={(e) => set({ postcode: e.target.value })}
                  maxLength={20}
                />
              </div>
            </div>

            <label className="flex items-center gap-3 text-left">
              <Checkbox checked={isHome} onCheckedChange={(v) => setIsHome(v === true)} />
              <span className="text-smoke text-xs tracking-[0.15em] uppercase">
                This is my home address
              </span>
            </label>

            <Button
              type="submit"
              disabled={!ready || save.isPending}
              className="w-full tracking-[0.2em] uppercase"
            >
              {save.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save Address"}
            </Button>
            {!addressUsable(fields) && (
              <p className="text-smoke/60 text-xs text-left">
                A street and either a town or a postcode, so a car can be sent to it.
              </p>
            )}
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AddressBook;
