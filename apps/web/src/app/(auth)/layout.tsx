import Link from "next/link";
import Image from "next/image";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <div className="flex items-center justify-center border-b border-[#262626] bg-[#0A0A0A] py-4">
        <Link href="/" className="flex items-center gap-3">
          <Image src="/logo-inuka.png" alt="INUKA" width={100} height={50} className="h-9 w-auto" />
          <span className="font-light tracking-wide text-[#C9A962]">Angola</span>
        </Link>
      </div>
      {children}
    </div>
  );
}
