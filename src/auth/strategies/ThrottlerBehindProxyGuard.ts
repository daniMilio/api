import { Request } from "express";
import { Injectable } from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";

@Injectable()
export class ThrottlerBehindProxyGuard extends ThrottlerGuard {
  protected async getTracker(request: Request): Promise<string> {
    return request.headers["cf-connecting-ip"] as string;
  }
}
