import type { Metadata } from "next";
import { Geist, Geist_Mono, DM_Sans, Space_Mono} from "next/font/google";
import "../index.css";
import Providers from "@/components/providers";

const dmSans = DM_Sans({
	variable: "--font-sans",
	subsets: ["latin"],
});

const spaceMono = Space_Mono({
	variable: "--font-mono",
	subsets: ["latin"],
	weight: ["400", "700"],
});

export const metadata: Metadata = {
	title: "Gitterm",
	description: "Deploy remote development environments in seconds.",
};

export default function RootLayout({
	children,
}: Readonly<{
	children: React.ReactNode;
}>) {
	return (
		<html lang="en" suppressHydrationWarning>
			<body
				className={`${dmSans.variable} ${spaceMono.variable} antialiased`}
			>
				<Providers>
					{children}
				</Providers>
			</body>
		</html>
	);
}
