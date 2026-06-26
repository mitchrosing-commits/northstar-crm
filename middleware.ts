import { NextResponse, type NextRequest } from "next/server";

const localSessionCookieName = "northstar_session";

const protectedAppRoutePrefixes = [
  "/dashboard",
  "/pipeline",
  "/deals",
  "/contacts",
  "/organizations",
  "/leads",
  "/activities",
  "/email",
  "/reports",
  "/settings",
  "/products",
  "/custom-fields",
  "/search"
];

export function middleware(request: NextRequest) {
  if (process.env.AUTH_MODE !== "local") return NextResponse.next();

  const { pathname, search } = request.nextUrl;
  if (!isProtectedAppPath(pathname)) return NextResponse.next();
  if (request.cookies.get(localSessionCookieName)?.value) return NextResponse.next();

  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.search = "";
  loginUrl.searchParams.set("next", `${pathname}${search}`);

  return NextResponse.redirect(loginUrl);
}

function isProtectedAppPath(pathname: string) {
  return protectedAppRoutePrefixes.some((route) => pathname === route || pathname.startsWith(`${route}/`));
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|q/).*)"]
};
