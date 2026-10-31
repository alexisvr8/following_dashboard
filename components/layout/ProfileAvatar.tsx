import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

export function ProfileAvatar() {
  return (
    <Avatar>
      <AvatarImage src="/avatar-placeholder.svg" alt="Perfil" />
      <AvatarFallback>XT</AvatarFallback>
    </Avatar>
  );
}
