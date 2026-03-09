export default {
  test: {
    include: ["src/openclawcode/testing/**/*.test.ts"],
    environment: "node",
    pool: "threads",
    testTimeout: 15000
  }
};
