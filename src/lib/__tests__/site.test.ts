// Pins for the "this computer" check behind the share-link note and the
// local models' group label: loopback names and addresses only. A home
// network address or a public name can be reached from elsewhere.
import { describe, expect, it } from "vitest";
import { isLoopbackHost, isLoopbackUrl } from "@/lib/site";

describe("isLoopbackHost / isLoopbackUrl", () => {
  it("this computer: localhost, *.localhost, 127.x.x.x and [::1]", () => {
    for (const host of ["localhost", "LOCALHOST", "sylou.localhost", "127.0.0.1", "127.1.2.3", "[::1]"]) {
      expect(isLoopbackHost(host), host).toBe(true);
    }
    for (const url of ["http://localhost:8080/report/abc", "http://127.0.0.1:54321", "http://[::1]:8080/", "http://sylou.localhost"]) {
      expect(isLoopbackUrl(url), url).toBe(true);
    }
  });

  it("anywhere else: a home network address, a public name, look-alikes, or no URL at all", () => {
    for (const host of ["192.168.1.20", "10.0.0.5", "sylou.eu", "localhost.example.com", "127.0.0.1.example.com", "1270.0.0.1"]) {
      expect(isLoopbackHost(host), host).toBe(false);
    }
    for (const url of ["https://sylou.eu/report/abc", "http://192.168.1.20:8080", "", "not a url"]) {
      expect(isLoopbackUrl(url), url).toBe(false);
    }
  });
});
