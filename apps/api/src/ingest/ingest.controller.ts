import { Controller, Post } from "@nestjs/common";
import { IngestService } from "./ingest.service";

@Controller("ingest")
export class IngestController {
  constructor(private readonly ingest: IngestService) {}

  @Post("run")
  async runOnce() {
    return await this.ingest.runTick();
  }
}
