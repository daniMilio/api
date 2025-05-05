import { Test, TestingModule } from "@nestjs/testing";
import { SignalServerGateway } from "./signal-server.gateway";

describe("SignalServerGateway", () => {
  let gateway: SignalServerGateway;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [SignalServerGateway],
    }).compile();

    gateway = module.get<SignalServerGateway>(SignalServerGateway);
  });

  it("should be defined", () => {
    expect(gateway).toBeDefined();
  });
});
