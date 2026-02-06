/**
 * index.test.ts
 * Tests for the entry point with multi-transport support
 */

// Mock projectUtils first to avoid import.meta.url issues
jest.mock('./utils/projectUtils.js', () => ({
  findProjectRoot: jest.fn(),
}));

// Mock core dependencies
jest.mock('@modelcontextprotocol/sdk/server/stdio.js');
jest.mock('./config/index.js');
jest.mock('./server/server.js');

// Mock the HTTP transport module at the top level
jest.mock('./server/transports/http/index.js', () => ({
  createHttpTransport: jest.fn(),
}));

import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { FullServerConfig } from './config/index.js';
import { loadConfig } from './config/index.js';
import { createServer } from './server/server.js';
import { createHttpTransport } from './server/transports/http/index.js';

const mockLoadConfig = loadConfig as jest.MockedFunction<typeof loadConfig>;
const mockCreateServer = createServer as jest.MockedFunction<
  typeof createServer
>;
const mockStdioServerTransport = StdioServerTransport as jest.MockedClass<
  typeof StdioServerTransport
>;
const mockCreateHttpTransport = createHttpTransport as jest.MockedFunction<
  typeof createHttpTransport
>;

// Default config for stdio mode
const defaultConfig: FullServerConfig = {
  name: 'mcp-server-apple-apps',
  version: '0.11.0',
  transport: 'stdio',
};

describe('index', () => {
  let mockServerInstance: jest.Mocked<Server>;
  let mockTransportInstance: jest.Mocked<StdioServerTransport>;
  let mockExit: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock server instance
    mockServerInstance = {
      connect: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<Server>;

    // Mock transport instance
    mockTransportInstance = {} as jest.Mocked<StdioServerTransport>;

    mockLoadConfig.mockReturnValue(defaultConfig);
    mockCreateServer.mockReturnValue(mockServerInstance);
    mockStdioServerTransport.mockImplementation(() => mockTransportInstance);

    // Mock process.exit by default
    mockExit = jest.spyOn(process, 'exit').mockImplementation((() => {
      // Prevent actual exit
    }) as () => never);
  });

  afterEach(() => {
    mockExit.mockRestore();
  });

  describe('stdio transport (default)', () => {
    it('should load config and start server with stdio transport', async () => {
      // Use isolateModules to get a fresh import without clearing mocks
      await jest.isolateModulesAsync(async () => {
        await import('./index.js');
      });

      // Wait for async main() to complete
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockLoadConfig).toHaveBeenCalled();
      expect(mockCreateServer).toHaveBeenCalledWith(defaultConfig);
      expect(mockStdioServerTransport).toHaveBeenCalled();
      expect(mockServerInstance.connect).toHaveBeenCalledWith(
        mockTransportInstance,
      );
    });

    it('should handle server startup errors and exit with code 1', async () => {
      const serverError = new Error('Server startup failed');
      mockServerInstance.connect.mockRejectedValue(serverError);

      await jest.isolateModulesAsync(async () => {
        await import('./index.js');
      });

      // Wait for async error handling
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(mockExit).toHaveBeenCalledWith(1);
    });
  });

  describe('http transport', () => {
    const httpConfig: FullServerConfig = {
      name: 'mcp-server-apple-apps',
      version: '0.11.0',
      transport: 'http',
      http: {
        enabled: true,
        host: '127.0.0.1',
        port: 3847,
      },
    };

    it('should throw error when http transport requested but not enabled', async () => {
      const invalidConfig: FullServerConfig = {
        name: 'mcp-server-apple-apps',
        version: '0.11.0',
        transport: 'http',
        // http.enabled is false by default or missing
      };

      mockLoadConfig.mockReturnValue(invalidConfig);

      await jest.isolateModulesAsync(async () => {
        await import('./index.js');
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it('should start http transport when configured', async () => {
      const mockHttpTransportInstance = {
        app: {},
        start: jest.fn().mockResolvedValue(undefined),
        stop: jest.fn().mockResolvedValue(undefined),
      };

      mockLoadConfig.mockReturnValue(httpConfig);
      mockCreateHttpTransport.mockReturnValue(
        mockHttpTransportInstance as unknown as ReturnType<
          typeof createHttpTransport
        >,
      );

      await jest.isolateModulesAsync(async () => {
        await import('./index.js');
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(mockCreateHttpTransport).toHaveBeenCalledWith(
        mockServerInstance,
        httpConfig,
        httpConfig.http,
      );
      expect(mockHttpTransportInstance.start).toHaveBeenCalled();
    });
  });

  describe('both transports', () => {
    const bothConfig: FullServerConfig = {
      name: 'mcp-server-apple-apps',
      version: '0.11.0',
      transport: 'both',
      http: {
        enabled: true,
        host: '127.0.0.1',
        port: 3847,
      },
    };

    it('should start both stdio and http transports', async () => {
      const mockHttpTransportInstance = {
        app: {},
        start: jest.fn().mockResolvedValue(undefined),
        stop: jest.fn().mockResolvedValue(undefined),
      };

      mockLoadConfig.mockReturnValue(bothConfig);
      mockCreateHttpTransport.mockReturnValue(
        mockHttpTransportInstance as unknown as ReturnType<
          typeof createHttpTransport
        >,
      );

      await jest.isolateModulesAsync(async () => {
        await import('./index.js');
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify stdio was started
      expect(mockStdioServerTransport).toHaveBeenCalled();
      expect(mockServerInstance.connect).toHaveBeenCalledWith(
        mockTransportInstance,
      );

      // Verify http was started
      expect(mockCreateHttpTransport).toHaveBeenCalled();
      expect(mockHttpTransportInstance.start).toHaveBeenCalled();
    });
  });

  describe('graceful shutdown', () => {
    it('should register SIGINT and SIGTERM handlers', async () => {
      const onSpy = jest.spyOn(process, 'on');

      await jest.isolateModulesAsync(async () => {
        await import('./index.js');
      });

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(onSpy).toHaveBeenCalledWith('SIGINT', expect.any(Function));
      expect(onSpy).toHaveBeenCalledWith('SIGTERM', expect.any(Function));

      onSpy.mockRestore();
    });
  });
});
