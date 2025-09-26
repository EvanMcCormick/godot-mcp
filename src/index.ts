#!/usr/bin/env node
/**
 * Godot MCP Server
 *
 * This MCP server provides tools for interacting with the Godot game engine.
 * It enables AI assistants to launch the Godot editor, run Godot projects,
 * capture debug output, and control project execution.
 */

import { fileURLToPath } from 'url';
import { join, dirname, basename, normalize } from 'path';
import { existsSync, readdirSync, mkdirSync } from 'fs';
import { spawn } from 'child_process';
import { promisify } from 'util';
import { exec } from 'child_process';

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';

// Check if debug mode is enabled
const DEBUG_MODE: boolean = process.env.DEBUG === 'true';
const GODOT_DEBUG_MODE: boolean = true; // Always use GODOT DEBUG MODE

const execAsync = promisify(exec);

// Derive __filename and __dirname in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Interface representing a running Godot process
 */
interface GodotProcess {
  process: any;
  output: string[];
  errors: string[];
}

/**
 * Interface for server configuration
 */
interface GodotServerConfig {
  godotPath?: string;
  debugMode?: boolean;
  godotDebugMode?: boolean;
  strictPathValidation?: boolean; // New option to control path validation behavior
}

/**
 * Interface for operation parameters
 */
interface OperationParams {
  [key: string]: any;
}

/**
 * Main server class for the Godot MCP server
 */
class GodotServer {
  private server: Server;
  private activeProcess: GodotProcess | null = null;
  private godotPath: string | null = null;
  private operationsScriptPath: string;
  private validatedPaths: Map<string, boolean> = new Map();
  private strictPathValidation: boolean = false;

  /**
   * Parameter name mappings between snake_case and camelCase
   * This allows the server to accept both formats
   */
  private parameterMappings: Record<string, string> = {
    'project_path': 'projectPath',
    'scene_path': 'scenePath',
    'root_node_type': 'rootNodeType',
    'parent_node_path': 'parentNodePath',
    'node_type': 'nodeType',
    'node_name': 'nodeName',
    'texture_path': 'texturePath',
    'node_path': 'nodePath',
    'output_path': 'outputPath',
    'mesh_item_names': 'meshItemNames',
    'new_path': 'newPath',
    'file_path': 'filePath',
    'directory': 'directory',
    'recursive': 'recursive',
    'scene': 'scene',
  };

  /**
   * Reverse mapping from camelCase to snake_case
   * Generated from parameterMappings for quick lookups
   */
  private reverseParameterMappings: Record<string, string> = {};

  constructor(config?: GodotServerConfig) {
    // Initialize reverse parameter mappings
    for (const [snakeCase, camelCase] of Object.entries(this.parameterMappings)) {
      this.reverseParameterMappings[camelCase] = snakeCase;
    }
    // Apply configuration if provided
    let debugMode = DEBUG_MODE;
    let godotDebugMode = GODOT_DEBUG_MODE;

    if (config) {
      if (config.debugMode !== undefined) {
        debugMode = config.debugMode;
      }
      if (config.godotDebugMode !== undefined) {
        godotDebugMode = config.godotDebugMode;
      }
      if (config.strictPathValidation !== undefined) {
        this.strictPathValidation = config.strictPathValidation;
      }

      // Store and validate custom Godot path if provided
      if (config.godotPath) {
        const normalizedPath = normalize(config.godotPath);
        this.godotPath = normalizedPath;
        this.logDebug(`Custom Godot path provided: ${this.godotPath}`);

        // Validate immediately with sync check
        if (!this.isValidGodotPathSync(this.godotPath)) {
          console.warn(`[SERVER] Invalid custom Godot path provided: ${this.godotPath}`);
          this.godotPath = null; // Reset to trigger auto-detection later
        }
      }
    }

    // Set the path to the operations script
    this.operationsScriptPath = join(__dirname, 'scripts', 'godot_operations.gd');
    if (debugMode) console.debug(`[DEBUG] Operations script path: ${this.operationsScriptPath}`);

    // Initialize the MCP server
    this.server = new Server(
      {
        name: 'godot-mcp',
        version: '0.2.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    // Set up tool handlers
    this.setupToolHandlers();

    // Error handling
    this.server.onerror = (error) => console.error('[MCP Error]', error);

    // Cleanup on exit
    process.on('SIGINT', async () => {
      await this.cleanup();
      process.exit(0);
    });
  }

  /**
   * Log debug messages if debug mode is enabled
   */
  private logDebug(message: string): void {
    if (DEBUG_MODE) {
      console.debug(`[DEBUG] ${message}`);
    }
  }

  /**
   * Create a standardized error response with possible solutions
   */
  private createErrorResponse(message: string, possibleSolutions: string[] = []): any {
    // Log the error
    console.error(`[SERVER] Error response: ${message}`);
    if (possibleSolutions.length > 0) {
      console.error(`[SERVER] Possible solutions: ${possibleSolutions.join(', ')}`);
    }

    const response: any = {
      content: [
        {
          type: 'text',
          text: message,
        },
      ],
      isError: true,
    };

    if (possibleSolutions.length > 0) {
      response.content.push({
        type: 'text',
        text: 'Possible solutions:\n- ' + possibleSolutions.join('\n- '),
      });
    }

    return response;
  }

  /**
   * Validate a path to prevent path traversal attacks
   */
  private validatePath(path: string): boolean {
    // Basic validation to prevent path traversal
    if (!path || path.includes('..')) {
      return false;
    }

    // Add more validation as needed
    return true;
  }

  /**
   * Synchronous validation for constructor use
   * This is a quick check that only verifies file existence, not executable validity
   * Full validation will be performed later in detectGodotPath
   * @param path Path to check
   * @returns True if the path exists or is 'godot' (which might be in PATH)
   */
  private isValidGodotPathSync(path: string): boolean {
    try {
      this.logDebug(`Quick-validating Godot path: ${path}`);
      return path === 'godot' || existsSync(path);
    } catch (error) {
      this.logDebug(`Invalid Godot path: ${path}, error: ${error}`);
      return false;
    }
  }

  /**
   * Validate if a Godot path is valid and executable
   */
  private async isValidGodotPath(path: string): Promise<boolean> {
    // Check cache first
    if (this.validatedPaths.has(path)) {
      return this.validatedPaths.get(path)!;
    }

    try {
      this.logDebug(`Validating Godot path: ${path}`);

      // Check if the file exists (skip for 'godot' which might be in PATH)
      if (path !== 'godot' && !existsSync(path)) {
        this.logDebug(`Path does not exist: ${path}`);
        this.validatedPaths.set(path, false);
        return false;
      }

      // Try to execute Godot with --version flag
      const command = path === 'godot' ? 'godot --version' : `"${path}" --version`;
      await execAsync(command);

      this.logDebug(`Valid Godot path: ${path}`);
      this.validatedPaths.set(path, true);
      return true;
    } catch (error) {
      this.logDebug(`Invalid Godot path: ${path}, error: ${error}`);
      this.validatedPaths.set(path, false);
      return false;
    }
  }

  /**
   * Detect the Godot executable path based on the operating system
   */
  private async detectGodotPath() {
    // If godotPath is already set and valid, use it
    if (this.godotPath && await this.isValidGodotPath(this.godotPath)) {
      this.logDebug(`Using existing Godot path: ${this.godotPath}`);
      return;
    }

    // Check environment variable next
    if (process.env.GODOT_PATH) {
      const normalizedPath = normalize(process.env.GODOT_PATH);
      this.logDebug(`Checking GODOT_PATH environment variable: ${normalizedPath}`);
      if (await this.isValidGodotPath(normalizedPath)) {
        this.godotPath = normalizedPath;
        this.logDebug(`Using Godot path from environment: ${this.godotPath}`);
        return;
      } else {
        this.logDebug(`GODOT_PATH environment variable is invalid`);
      }
    }

    // Auto-detect based on platform
    const osPlatform = process.platform;
    this.logDebug(`Auto-detecting Godot path for platform: ${osPlatform}`);

    const possiblePaths: string[] = [
      'godot', // Check if 'godot' is in PATH first
    ];

    // Add platform-specific paths
    if (osPlatform === 'darwin') {
      possiblePaths.push(
        '/Applications/Godot.app/Contents/MacOS/Godot',
        '/Applications/Godot_4.app/Contents/MacOS/Godot',
        '/Applications/Godot_4.5.app/Contents/MacOS/Godot',
        `${process.env.HOME}/Applications/Godot.app/Contents/MacOS/Godot`,
        `${process.env.HOME}/Applications/Godot_4.app/Contents/MacOS/Godot`,
        `${process.env.HOME}/Applications/Godot_4.5.app/Contents/MacOS/Godot`,
        `${process.env.HOME}/Library/Application Support/Steam/steamapps/common/Godot Engine/Godot.app/Contents/MacOS/Godot`
      );
    } else if (osPlatform === 'win32') {
      possiblePaths.push(
        'C:\\Program Files\\Godot\\Godot.exe',
        'C:\\Program Files (x86)\\Godot\\Godot.exe',
        'C:\\Program Files\\Godot_4\\Godot.exe',
        'C:\\Program Files (x86)\\Godot_4\\Godot.exe',
        'C:\\Program Files\\Godot_4.5\\Godot.exe',
        'C:\\Program Files (x86)\\Godot_4.5\\Godot.exe',
        `${process.env.USERPROFILE}\\Godot\\Godot.exe`
      );
    } else if (osPlatform === 'linux') {
      possiblePaths.push(
        '/usr/bin/godot',
        '/usr/local/bin/godot',
        '/snap/bin/godot',
        `${process.env.HOME}/.local/bin/godot`
      );
    }

    // Try each possible path
    for (const path of possiblePaths) {
      const normalizedPath = normalize(path);
      if (await this.isValidGodotPath(normalizedPath)) {
        this.godotPath = normalizedPath;
        this.logDebug(`Found Godot at: ${normalizedPath}`);
        return;
      }
    }

    // If we get here, we couldn't find Godot
    this.logDebug(`Warning: Could not find Godot in common locations for ${osPlatform}`);
    console.warn(`[SERVER] Could not find Godot in common locations for ${osPlatform}`);
    console.warn(`[SERVER] Set GODOT_PATH=/path/to/godot environment variable or pass { godotPath: '/path/to/godot' } in the config to specify the correct path.`);

    if (this.strictPathValidation) {
      // In strict mode, throw an error
      throw new Error(`Could not find a valid Godot executable. Set GODOT_PATH or provide a valid path in config.`);
    } else {
      // Fallback to a default path in non-strict mode; this may not be valid and requires user configuration for reliability
      if (osPlatform === 'win32') {
        this.godotPath = normalize('C:\\Program Files\\Godot\\Godot.exe');
      } else if (osPlatform === 'darwin') {
        this.godotPath = normalize('/Applications/Godot.app/Contents/MacOS/Godot');
      } else {
        this.godotPath = normalize('/usr/bin/godot');
      }

      this.logDebug(`Using default path: ${this.godotPath}, but this may not work.`);
      console.warn(`[SERVER] Using default path: ${this.godotPath}, but this may not work.`);
      console.warn(`[SERVER] This fallback behavior will be removed in a future version. Set strictPathValidation: true to opt-in to the new behavior.`);
    }
  }

  /**
   * Set a custom Godot path
   * @param customPath Path to the Godot executable
   * @returns True if the path is valid and was set, false otherwise
   */
  public async setGodotPath(customPath: string): Promise<boolean> {
    if (!customPath) {
      return false;
    }

    // Normalize the path to ensure consistent format across platforms
    // (e.g., backslashes to forward slashes on Windows, resolving relative paths)
    const normalizedPath = normalize(customPath);
    if (await this.isValidGodotPath(normalizedPath)) {
      this.godotPath = normalizedPath;
      this.logDebug(`Godot path set to: ${normalizedPath}`);
      return true;
    }

    this.logDebug(`Failed to set invalid Godot path: ${normalizedPath}`);
    return false;
  }

  /**
   * Clean up resources when shutting down
   */
  private async cleanup() {
    this.logDebug('Cleaning up resources');
    if (this.activeProcess) {
      this.logDebug('Killing active Godot process');
      this.activeProcess.process.kill();
      this.activeProcess = null;
    }
    await this.server.close();
  }

  /**
   * Check if the Godot version is 4.4 or later
   * @param version The Godot version string
   * @returns True if the version is 4.4 or later
   */
  private isGodot44OrLater(version: string): boolean {
    const match = version.match(/^(\d+)\.(\d+)/);
    if (match) {
      const major = parseInt(match[1], 10);
      const minor = parseInt(match[2], 10);
      return major > 4 || (major === 4 && minor >= 4);
    }
    return false;
  }

  /**
   * Check if the Godot version is 4.5 or later
   * @param version The Godot version string
   * @returns True if the version is 4.5 or later
   */
  private isGodot45OrLater(version: string): boolean {
    const match = version.match(/^(\d+)\.(\d+)/);
    if (match) {
      const major = parseInt(match[1], 10);
      const minor = parseInt(match[2], 10);
      return major > 4 || (major === 4 && minor >= 5);
    }
    return false;
  }

  /**
   * Normalize parameters to camelCase format
   * @param params Object with either snake_case or camelCase keys
   * @returns Object with all keys in camelCase format
   */
  private normalizeParameters(params: OperationParams): OperationParams {
    if (!params || typeof params !== 'object') {
      return params;
    }
    
    const result: OperationParams = {};
    
    for (const key in params) {
      if (Object.prototype.hasOwnProperty.call(params, key)) {
        let normalizedKey = key;
        
        // If the key is in snake_case, convert it to camelCase using our mapping
        if (key.includes('_') && this.parameterMappings[key]) {
          normalizedKey = this.parameterMappings[key];
        }
        
        // Handle nested objects recursively
        if (typeof params[key] === 'object' && params[key] !== null && !Array.isArray(params[key])) {
          result[normalizedKey] = this.normalizeParameters(params[key] as OperationParams);
        } else {
          result[normalizedKey] = params[key];
        }
      }
    }
    
    return result;
  }

  /**
   * Convert camelCase keys to snake_case
   * @param params Object with camelCase keys
   * @returns Object with snake_case keys
   */
  private convertCamelToSnakeCase(params: OperationParams): OperationParams {
    const result: OperationParams = {};
    
    for (const key in params) {
      if (Object.prototype.hasOwnProperty.call(params, key)) {
        // Convert camelCase to snake_case
        const snakeKey = this.reverseParameterMappings[key] || key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
        
        // Handle nested objects recursively
        if (typeof params[key] === 'object' && params[key] !== null && !Array.isArray(params[key])) {
          result[snakeKey] = this.convertCamelToSnakeCase(params[key] as OperationParams);
        } else {
          result[snakeKey] = params[key];
        }
      }
    }
    
    return result;
  }

  /**
   * Execute a Godot operation using the operations script
   * @param operation The operation to execute
   * @param params The parameters for the operation
   * @param projectPath The path to the Godot project
   * @returns The stdout and stderr from the operation
   */
  private async executeOperation(
    operation: string,
    params: OperationParams,
    projectPath: string
  ): Promise<{ stdout: string; stderr: string }> {
    this.logDebug(`Executing operation: ${operation} in project: ${projectPath}`);
    this.logDebug(`Original operation params: ${JSON.stringify(params)}`);

    // Convert camelCase parameters to snake_case for Godot script
    const snakeCaseParams = this.convertCamelToSnakeCase(params);
    this.logDebug(`Converted snake_case params: ${JSON.stringify(snakeCaseParams)}`);


    // Ensure godotPath is set
    if (!this.godotPath) {
      await this.detectGodotPath();
      if (!this.godotPath) {
        throw new Error('Could not find a valid Godot executable path');
      }
    }

    try {
      // Serialize the snake_case parameters to a valid JSON string
      const paramsJson = JSON.stringify(snakeCaseParams);
      // Escape single quotes in the JSON string to prevent command injection
      const escapedParams = paramsJson.replace(/'/g, "'\\''");
      // On Windows, cmd.exe does not strip single quotes, so we use
      // double quotes and escape them to ensure the JSON is parsed
      // correctly by Godot.
      const isWindows = process.platform === 'win32';
      const quotedParams = isWindows
        ? `\"${paramsJson.replace(/\"/g, '\\"')}\"`
        : `'${escapedParams}'`;


      // Add debug arguments if debug mode is enabled
      const debugArgs = GODOT_DEBUG_MODE ? ['--debug-godot'] : [];

      // Construct the command with the operation and JSON parameters
      const cmd = [
        `"${this.godotPath}"`,
        '--headless',
        '--path',
        `"${projectPath}"`,
        '--script',
        `"${this.operationsScriptPath}"`,
        operation,
        quotedParams, // Pass the JSON string as a single argument
        ...debugArgs,
      ].join(' ');

      this.logDebug(`Command: ${cmd}`);

      const { stdout, stderr } = await execAsync(cmd);

      return { stdout, stderr };
    } catch (error: unknown) {
      // If execAsync throws, it still contains stdout/stderr
      if (error instanceof Error && 'stdout' in error && 'stderr' in error) {
        const execError = error as Error & { stdout: string; stderr: string };
        return {
          stdout: execError.stdout,
          stderr: execError.stderr,
        };
      }

      throw error;
    }
  }

  /**
   * Get the structure of a Godot project
   * @param projectPath Path to the Godot project
   * @returns Object representing the project structure
   */
  private async getProjectStructure(projectPath: string): Promise<any> {
    try {
      // Get top-level directories in the project
      const entries = readdirSync(projectPath, { withFileTypes: true });

      const structure: any = {
        scenes: [],
        scripts: [],
        assets: [],
        other: [],
      };

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const dirName = entry.name.toLowerCase();

          // Skip hidden directories
          if (dirName.startsWith('.')) {
            continue;
          }

          // Count files in common directories
          if (dirName === 'scenes' || dirName.includes('scene')) {
            structure.scenes.push(entry.name);
          } else if (dirName === 'scripts' || dirName.includes('script')) {
            structure.scripts.push(entry.name);
          } else if (
            dirName === 'assets' ||
            dirName === 'textures' ||
            dirName === 'models' ||
            dirName === 'sounds' ||
            dirName === 'music'
          ) {
            structure.assets.push(entry.name);
          } else {
            structure.other.push(entry.name);
          }
        }
      }

      return structure;
    } catch (error) {
      this.logDebug(`Error getting project structure: ${error}`);
      return { error: 'Failed to get project structure' };
    }
  }

  /**
   * Find Godot projects in a directory
   * @param directory Directory to search
   * @param recursive Whether to search recursively
   * @returns Array of Godot projects
   */
  private findGodotProjects(directory: string, recursive: boolean): Array<{ path: string; name: string }> {
    const projects: Array<{ path: string; name: string }> = [];

    try {
      // Check if the directory itself is a Godot project
      const projectFile = join(directory, 'project.godot');
      if (existsSync(projectFile)) {
        projects.push({
          path: directory,
          name: basename(directory),
        });
      }

      // If not recursive, only check immediate subdirectories
      if (!recursive) {
        const entries = readdirSync(directory, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            const subdir = join(directory, entry.name);
            const projectFile = join(subdir, 'project.godot');
            if (existsSync(projectFile)) {
              projects.push({
                path: subdir,
                name: entry.name,
              });
            }
          }
        }
      } else {
        // Recursive search
        const entries = readdirSync(directory, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            const subdir = join(directory, entry.name);
            // Skip hidden directories
            if (entry.name.startsWith('.')) {
              continue;
            }
            // Check if this directory is a Godot project
            const projectFile = join(subdir, 'project.godot');
            if (existsSync(projectFile)) {
              projects.push({
                path: subdir,
                name: entry.name,
              });
            } else {
              // Recursively search this directory
              const subProjects = this.findGodotProjects(subdir, true);
              projects.push(...subProjects);
            }
          }
        }
      }
    } catch (error) {
      this.logDebug(`Error searching directory ${directory}: ${error}`);
    }

    return projects;
  }

  /**
   * Set up the tool handlers for the MCP server
   */
  private setupToolHandlers() {
    // Define available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'launch_editor',
          description: 'Launch Godot editor for a specific project',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: {
                type: 'string',
                description: 'Path to the Godot project directory',
              },
            },
            required: ['projectPath'],
          },
        },
        {
          name: 'run_project',
          description: 'Run the Godot project and capture output',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: {
                type: 'string',
                description: 'Path to the Godot project directory',
              },
              scene: {
                type: 'string',
                description: 'Optional: Specific scene to run',
              },
            },
            required: ['projectPath'],
          },
        },
        {
          name: 'get_debug_output',
          description: 'Get the current debug output and errors',
          inputSchema: {
            type: 'object',
            properties: {},
            required: [],
          },
        },
        {
          name: 'stop_project',
          description: 'Stop the currently running Godot project',
          inputSchema: {
            type: 'object',
            properties: {},
            required: [],
          },
        },
        {
          name: 'get_godot_version',
          description: 'Get the installed Godot version',
          inputSchema: {
            type: 'object',
            properties: {},
            required: [],
          },
        },
        {
          name: 'list_projects',
          description: 'List Godot projects in a directory',
          inputSchema: {
            type: 'object',
            properties: {
              directory: {
                type: 'string',
                description: 'Directory to search for Godot projects',
              },
              recursive: {
                type: 'boolean',
                description: 'Whether to search recursively (default: false)',
              },
            },
            required: ['directory'],
          },
        },
        {
          name: 'get_project_info',
          description: 'Retrieve metadata about a Godot project',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: {
                type: 'string',
                description: 'Path to the Godot project directory',
              },
            },
            required: ['projectPath'],
          },
        },
        {
          name: 'create_scene',
          description: 'Create a new Godot scene file',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: {
                type: 'string',
                description: 'Path to the Godot project directory',
              },
              scenePath: {
                type: 'string',
                description: 'Path where the scene file will be saved (relative to project)',
              },
              rootNodeType: {
                type: 'string',
                description: 'Type of the root node (e.g., Node2D, Node3D)',
                default: 'Node2D',
              },
            },
            required: ['projectPath', 'scenePath'],
          },
        },
        {
          name: 'add_node',
          description: 'Add a node to an existing scene',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: {
                type: 'string',
                description: 'Path to the Godot project directory',
              },
              scenePath: {
                type: 'string',
                description: 'Path to the scene file (relative to project)',
              },
              parentNodePath: {
                type: 'string',
                description: 'Path to the parent node (e.g., "root" or "root/Player")',
                default: 'root',
              },
              nodeType: {
                type: 'string',
                description: 'Type of node to add (e.g., Sprite2D, CollisionShape2D)',
              },
              nodeName: {
                type: 'string',
                description: 'Name for the new node',
              },
              properties: {
                type: 'object',
                description: 'Optional properties to set on the node',
              },
            },
            required: ['projectPath', 'scenePath', 'nodeType', 'nodeName'],
          },
        },
        {
          name: 'load_sprite',
          description: 'Load a sprite into a Sprite2D node',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: {
                type: 'string',
                description: 'Path to the Godot project directory',
              },
              scenePath: {
                type: 'string',
                description: 'Path to the scene file (relative to project)',
              },
              nodePath: {
                type: 'string',
                description: 'Path to the Sprite2D node (e.g., "root/Player/Sprite2D")',
              },
              texturePath: {
                type: 'string',
                description: 'Path to the texture file (relative to project)',
              },
            },
            required: ['projectPath', 'scenePath', 'nodePath', 'texturePath'],
          },
        },
        {
          name: 'export_mesh_library',
          description: 'Export a scene as a MeshLibrary resource',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: {
                type: 'string',
                description: 'Path to the Godot project directory',
              },
              scenePath: {
                type: 'string',
                description: 'Path to the scene file (.tscn) to export',
              },
              outputPath: {
                type: 'string',
                description: 'Path where the mesh library (.res) will be saved',
              },
              meshItemNames: {
                type: 'array',
                items: {
                  type: 'string',
                },
                description: 'Optional: Names of specific mesh items to include (defaults to all)',
              },
            },
            required: ['projectPath', 'scenePath', 'outputPath'],
          },
        },
        {
          name: 'save_scene',
          description: 'Save changes to a scene file',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: {
                type: 'string',
                description: 'Path to the Godot project directory',
              },
              scenePath: {
                type: 'string',
                description: 'Path to the scene file (relative to project)',
              },
              newPath: {
                type: 'string',
                description: 'Optional: New path to save the scene to (for creating variants)',
              },
            },
            required: ['projectPath', 'scenePath'],
          },
        },
        {
          name: 'get_uid',
          description: 'Get the UID for a specific file in a Godot project (for Godot 4.4+)',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: {
                type: 'string',
                description: 'Path to the Godot project directory',
              },
              filePath: {
                type: 'string',
                description: 'Path to the file (relative to project) for which to get the UID',
              },
            },
            required: ['projectPath', 'filePath'],
          },
        },
        {
          name: 'update_project_uids',
          description: 'Update UID references in a Godot project by resaving resources (for Godot 4.4+)',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: {
                type: 'string',
                description: 'Path to the Godot project directory',
              },
            },
            required: ['projectPath'],
          },
        },
        {
          name: 'duplicate_resource_advanced',
          description: 'Duplicate a resource with advanced options using Godot 4.5+ duplicate_deep() methods',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: {
                type: 'string',
                description: 'Path to the Godot project directory',
              },
              resourcePath: {
                type: 'string',
                description: 'Path to the resource file to duplicate (relative to project)',
              },
              outputPath: {
                type: 'string',
                description: 'Optional: Path where the duplicated resource will be saved (relative to project). If omitted, generates a default path.',
              },
              useDeepDuplication: {
                type: 'boolean',
                description: 'Whether to use deep duplication (default: false)',
                default: false,
              },
              duplicateExternalResources: {
                type: 'boolean',
                description: 'Whether to duplicate external resources (requires useDeepDuplication=true, uses RESOURCE_DEEP_DUPLICATE_ALL in Godot 4.5+)',
                default: false,
              },
            },
            required: ['projectPath', 'resourcePath'],
          },
        },
        {
          name: 'configure_tilemap_layer',
          description: 'Configure TileMapLayer properties including Godot 4.5+ physics chunking options',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: {
                type: 'string',
                description: 'Path to the Godot project directory',
              },
              scenePath: {
                type: 'string',
                description: 'Path to the scene file (relative to project)',
              },
              tileMapLayerPath: {
                type: 'string',
                description: 'Path to the TileMapLayer node (e.g., "root/TileMap/TileMapLayer")',
              },
              physicsQuadrantSize: {
                type: 'integer',
                description: 'Physics quadrant size for chunking (Godot 4.5+). Set to 1 to disable chunking for precise coordinates. Default is 16.',
                default: 16,
              },
              renderingQuadrantSize: {
                type: 'integer',
                description: 'Rendering quadrant size for performance optimization. Default is 16.',
                default: 16,
              },
              collisionEnabled: {
                type: 'boolean',
                description: 'Whether collision is enabled for this layer',
                default: true,
              },
              navigationEnabled: {
                type: 'boolean',
                description: 'Whether navigation is enabled for this layer',
                default: false,
              },
            },
            required: ['projectPath', 'scenePath', 'tileMapLayerPath'],
          },
        },
        {
          name: 'create_foldable_container',
          description: 'Create a FoldableContainer UI node (Godot 4.5+ feature) that allows collapsible content sections',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: {
                type: 'string',
                description: 'Path to the Godot project directory',
              },
              scenePath: {
                type: 'string',
                description: 'Path to the scene file (relative to project)',
              },
              nodeName: {
                type: 'string',
                description: 'Name for the FoldableContainer node',
              },
              parentNodePath: {
                type: 'string',
                description: 'Path to the parent node (e.g., "root" or "root/UI")',
                default: 'root',
              },
              title: {
                type: 'string',
                description: 'Title text displayed on the foldable header',
                default: 'Foldable Section',
              },
              folded: {
                type: 'boolean',
                description: 'Whether the container starts folded/collapsed',
                default: false,
              },
              toggleMode: {
                type: 'boolean',
                description: 'Whether clicking the header toggles the fold state',
                default: true,
              },
            },
            required: ['projectPath', 'scenePath', 'nodeName'],
          },
        },
        {
          name: 'configure_navigation_async',
          description: 'Configure NavigationServer asynchronous region updates (Godot 4.5+ performance feature)',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: {
                type: 'string',
                description: 'Path to the Godot project directory',
              },
              enableAsyncRegionUpdates: {
                type: 'boolean',
                description: 'Enable asynchronous navigation region updates for better performance (default: true in Godot 4.5+)',
                default: true,
              },
              mergeRasterizerCellScale: {
                type: 'number',
                description: 'Navigation mesh merge rasterizer cell scale (0.01 to 1.0, default: 0.25). Lower values increase detail but reduce performance.',
                default: 0.25,
              },
              applyToProject: {
                type: 'boolean',
                description: 'Apply settings to project.godot file (persistent across sessions)',
                default: true,
              },
            },
            required: ['projectPath'],
          },
        },
        {
          name: 'audit_migration_45',
          description: 'Scan the Godot project for patterns needing attention when migrating from 4.4 to 4.5 (duplicate(true), get_rpc_config, RichText size_in_percent, navigation async settings, tilemap quadrant sizing). Returns categorized JSON findings with remediation suggestions.',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: {
                type: 'string',
                description: 'Path to the Godot project directory'
              },
              includePatterns: {
                type: 'array',
                items: { type: 'string' },
                description: 'File extensions (without dot) to include, e.g. ["gd","tscn"]. Default covers gd, tscn, tres, cs, cfg.'
              }
            },
            required: ['projectPath']
          }
        },
        {
          name: 'audit_scripts_gd',
          description: 'Static analysis of GDScript files: class_name/filename mismatch, undocumented signals, load() vs preload(), TODO/FIXME markers, basic deprecated pattern heuristics.',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: { type: 'string', description: 'Path to the Godot project directory' },
              includePatterns: { type: 'array', items: { type: 'string' }, description: 'Extensions to include (default: ["gd"])' },
              maxFindingsPerFile: { type: 'number', description: 'Limit findings per file (default 10)' }
            },
            required: ['projectPath']
          }
        },
        {
          name: 'audit_scripts_cs',
          description: 'Static analysis of Godot C# scripts: namespace usage, missing partial keyword, filename/class mismatches, autoload misconfiguration (.cs referenced directly).',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: { type: 'string', description: 'Path to the Godot project directory' },
              includePatterns: { type: 'array', items: { type: 'string' }, description: 'Extensions to include (default: ["cs"])' },
              maxFindingsPerFile: { type: 'number', description: 'Limit findings per file (default 10)' }
            },
            required: ['projectPath']
          }
        },
        {
          name: 'scene_smoke_test',
          description: 'Load (and optionally instantiate) every .tscn scene to detect load or instantiation failures and missing external resource dependencies.',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: { type: 'string', description: 'Path to the Godot project directory' },
              includePatterns: { type: 'array', items: { type: 'string' }, description: 'Extensions to include (default: ["tscn"])' },
              instantiate: { type: 'boolean', description: 'Instantiate after load to catch runtime constructor issues (default false)' },
              maxScenes: { type: 'number', description: 'Upper limit of scenes to test (default 500)' }
            },
            required: ['projectPath']
          }
        },
        {
          name: 'validate_export_presets',
          description: 'Validate export_presets.cfg for each preset: required paths, platform conventions, Android signing fields, C#/.NET feature alignment, icon existence.',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: { type: 'string', description: 'Path to the Godot project directory' }
            },
            required: ['projectPath']
          }
        },
        {
          name: 'input_map_audit',
          description: 'Analyze InputMap in project.godot: duplicate actions, empty actions, duplicate events, legacy patterns.',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: { type: 'string', description: 'Path to the Godot project directory' }
            },
            required: ['projectPath']
          }
        },
        {
          name: 'physics_layer_audit',
          description: 'Scan scenes for physics bodies/areas and report collision layer/mask issues (zero layers, zero masks, redundant single-bit, excessive bits, orphan bits).',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: { type: 'string', description: 'Path to the Godot project directory' }
            },
            required: ['projectPath']
          }
        },
        {
          name: 'audio_bus_layout_audit',
          description: 'Inspect default_bus_layout.tres for audio mix issues: missing layout, only Master bus, missing Music/SFX/UI, clipping risk (positive dB), invalid sends, orphan buses, disabled effects.',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: { type: 'string', description: 'Path to the Godot project directory' }
            },
            required: ['projectPath']
          }
        },
      ],
    }));

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      this.logDebug(`Handling tool request: ${request.params.name}`);
      switch (request.params.name) {
        case 'launch_editor':
          return await this.handleLaunchEditor(request.params.arguments);
        case 'run_project':
          return await this.handleRunProject(request.params.arguments);
        case 'get_debug_output':
          return await this.handleGetDebugOutput();
        case 'stop_project':
          return await this.handleStopProject();
        case 'get_godot_version':
          return await this.handleGetGodotVersion();
        case 'list_projects':
          return await this.handleListProjects(request.params.arguments);
        case 'get_project_info':
          return await this.handleGetProjectInfo(request.params.arguments);
        case 'create_scene':
          return await this.handleCreateScene(request.params.arguments);
        case 'add_node':
          return await this.handleAddNode(request.params.arguments);
        case 'load_sprite':
          return await this.handleLoadSprite(request.params.arguments);
        case 'export_mesh_library':
          return await this.handleExportMeshLibrary(request.params.arguments);
        case 'save_scene':
          return await this.handleSaveScene(request.params.arguments);
        case 'get_uid':
          return await this.handleGetUid(request.params.arguments);
        case 'update_project_uids':
          return await this.handleUpdateProjectUids(request.params.arguments);
        case 'duplicate_resource_advanced':
          return await this.handleDuplicateResourceAdvanced(request.params.arguments);
        case 'configure_tilemap_layer':
          return await this.handleConfigureTileMapLayer(request.params.arguments);
        case 'create_foldable_container':
          return await this.handleCreateFoldableContainer(request.params.arguments);
        case 'configure_navigation_async':
          return await this.handleConfigureNavigationAsync(request.params.arguments);
        case 'audit_migration_45':
          return await this.handleAuditMigration45(request.params.arguments);
        case 'audit_scripts_gd':
          return await this.handleAuditScriptsGd(request.params.arguments);
        case 'audit_scripts_cs':
          return await this.handleAuditScriptsCs(request.params.arguments);
        case 'scene_smoke_test':
          return await this.handleSceneSmokeTest(request.params.arguments);
        case 'validate_export_presets':
          return await this.handleValidateExportPresets(request.params.arguments);
        case 'input_map_audit':
          return await this.handleInputMapAudit(request.params.arguments);
        case 'physics_layer_audit':
          return await this.handlePhysicsLayerAudit(request.params.arguments);
        case 'audio_bus_layout_audit':
          return await this.handleAudioBusLayoutAudit(request.params.arguments);
        default:
          throw new McpError(
            ErrorCode.MethodNotFound,
            `Unknown tool: ${request.params.name}`
          );
      }
    });
  }

  /**
   * Handle the launch_editor tool
   * @param args Tool arguments
   */
  private async handleLaunchEditor(args: any) {
    // Normalize parameters to camelCase
    args = this.normalizeParameters(args);
    
    if (!args.projectPath) {
      return this.createErrorResponse(
        'Project path is required',
        ['Provide a valid path to a Godot project directory']
      );
    }

    if (!this.validatePath(args.projectPath)) {
      return this.createErrorResponse(
        'Invalid project path',
        ['Provide a valid path without ".." or other potentially unsafe characters']
      );
    }

    try {
      // Ensure godotPath is set
      if (!this.godotPath) {
        await this.detectGodotPath();
        if (!this.godotPath) {
          return this.createErrorResponse(
            'Could not find a valid Godot executable path',
            [
              'Ensure Godot is installed correctly',
              'Set GODOT_PATH environment variable to specify the correct path',
            ]
          );
        }
      }

      // Check if the project directory exists and contains a project.godot file
      const projectFile = join(args.projectPath, 'project.godot');
      if (!existsSync(projectFile)) {
        return this.createErrorResponse(
          `Not a valid Godot project: ${args.projectPath}`,
          [
            'Ensure the path points to a directory containing a project.godot file',
            'Use list_projects to find valid Godot projects',
          ]
        );
      }

      this.logDebug(`Launching Godot editor for project: ${args.projectPath}`);
      const process = spawn(this.godotPath, ['-e', '--path', args.projectPath], {
        stdio: 'pipe',
      });

      process.on('error', (err: Error) => {
        console.error('Failed to start Godot editor:', err);
      });

      return {
        content: [
          {
            type: 'text',
            text: `Godot editor launched successfully for project at ${args.projectPath}.`,
          },
        ],
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return this.createErrorResponse(
        `Failed to launch Godot editor: ${errorMessage}`,
        [
          'Ensure Godot is installed correctly',
          'Check if the GODOT_PATH environment variable is set correctly',
          'Verify the project path is accessible',
        ]
      );
    }
  }

  /**
   * Handle the run_project tool
   * @param args Tool arguments
   */
  private async handleRunProject(args: any) {
    // Normalize parameters to camelCase
    args = this.normalizeParameters(args);
    
    if (!args.projectPath) {
      return this.createErrorResponse(
        'Project path is required',
        ['Provide a valid path to a Godot project directory']
      );
    }

    if (!this.validatePath(args.projectPath)) {
      return this.createErrorResponse(
        'Invalid project path',
        ['Provide a valid path without ".." or other potentially unsafe characters']
      );
    }

    try {
      // Check if the project directory exists and contains a project.godot file
      const projectFile = join(args.projectPath, 'project.godot');
      if (!existsSync(projectFile)) {
        return this.createErrorResponse(
          `Not a valid Godot project: ${args.projectPath}`,
          [
            'Ensure the path points to a directory containing a project.godot file',
            'Use list_projects to find valid Godot projects',
          ]
        );
      }

      // Kill any existing process
      if (this.activeProcess) {
        this.logDebug('Killing existing Godot process before starting a new one');
        this.activeProcess.process.kill();
      }

      const cmdArgs = ['-d', '--path', args.projectPath];
      if (args.scene && this.validatePath(args.scene)) {
        this.logDebug(`Adding scene parameter: ${args.scene}`);
        cmdArgs.push(args.scene);
      }

      this.logDebug(`Running Godot project: ${args.projectPath}`);
      const process = spawn(this.godotPath!, cmdArgs, { stdio: 'pipe' });
      const output: string[] = [];
      const errors: string[] = [];

      process.stdout?.on('data', (data: Buffer) => {
        const lines = data.toString().split('\n');
        output.push(...lines);
        lines.forEach((line: string) => {
          if (line.trim()) this.logDebug(`[Godot stdout] ${line}`);
        });
      });

      process.stderr?.on('data', (data: Buffer) => {
        const lines = data.toString().split('\n');
        errors.push(...lines);
        lines.forEach((line: string) => {
          if (line.trim()) this.logDebug(`[Godot stderr] ${line}`);
        });
      });

      process.on('exit', (code: number | null) => {
        this.logDebug(`Godot process exited with code ${code}`);
        if (this.activeProcess && this.activeProcess.process === process) {
          this.activeProcess = null;
        }
      });

      process.on('error', (err: Error) => {
        console.error('Failed to start Godot process:', err);
        if (this.activeProcess && this.activeProcess.process === process) {
          this.activeProcess = null;
        }
      });

      this.activeProcess = { process, output, errors };

      return {
        content: [
          {
            type: 'text',
            text: `Godot project started in debug mode. Use get_debug_output to see output.`,
          },
        ],
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return this.createErrorResponse(
        `Failed to run Godot project: ${errorMessage}`,
        [
          'Ensure Godot is installed correctly',
          'Check if the GODOT_PATH environment variable is set correctly',
          'Verify the project path is accessible',
        ]
      );
    }
  }

  /**
   * Handle the get_debug_output tool
   */
  private async handleGetDebugOutput() {
    if (!this.activeProcess) {
      return this.createErrorResponse(
        'No active Godot process.',
        [
          'Use run_project to start a Godot project first',
          'Check if the Godot process crashed unexpectedly',
        ]
      );
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              output: this.activeProcess.output,
              errors: this.activeProcess.errors,
            },
            null,
            2
          ),
        },
      ],
    };
  }

  /**
   * Handle the stop_project tool
   */
  private async handleStopProject() {
    if (!this.activeProcess) {
      return this.createErrorResponse(
        'No active Godot process to stop.',
        [
          'Use run_project to start a Godot project first',
          'The process may have already terminated',
        ]
      );
    }

    this.logDebug('Stopping active Godot process');
    this.activeProcess.process.kill();
    const output = this.activeProcess.output;
    const errors = this.activeProcess.errors;
    this.activeProcess = null;

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              message: 'Godot project stopped',
              finalOutput: output,
              finalErrors: errors,
            },
            null,
            2
          ),
        },
      ],
    };
  }

  /**
   * Handle the get_godot_version tool
   */
  private async handleGetGodotVersion() {
    try {
      // Ensure godotPath is set
      if (!this.godotPath) {
        await this.detectGodotPath();
        if (!this.godotPath) {
          return this.createErrorResponse(
            'Could not find a valid Godot executable path',
            [
              'Ensure Godot is installed correctly',
              'Set GODOT_PATH environment variable to specify the correct path',
            ]
          );
        }
      }

      this.logDebug('Getting Godot version');
      const { stdout } = await execAsync(`"${this.godotPath}" --version`);
      return {
        content: [
          {
            type: 'text',
            text: stdout.trim(),
          },
        ],
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return this.createErrorResponse(
        `Failed to get Godot version: ${errorMessage}`,
        [
          'Ensure Godot is installed correctly',
          'Check if the GODOT_PATH environment variable is set correctly',
        ]
      );
    }
  }

  /**
   * Handle the list_projects tool
   */
  private async handleListProjects(args: any) {
    // Normalize parameters to camelCase
    args = this.normalizeParameters(args);
    
    if (!args.directory) {
      return this.createErrorResponse(
        'Directory is required',
        ['Provide a valid directory path to search for Godot projects']
      );
    }

    if (!this.validatePath(args.directory)) {
      return this.createErrorResponse(
        'Invalid directory path',
        ['Provide a valid path without ".." or other potentially unsafe characters']
      );
    }

    try {
      this.logDebug(`Listing Godot projects in directory: ${args.directory}`);
      if (!existsSync(args.directory)) {
        return this.createErrorResponse(
          `Directory does not exist: ${args.directory}`,
          ['Provide a valid directory path that exists on the system']
        );
      }

      const recursive = args.recursive === true;
      const projects = this.findGodotProjects(args.directory, recursive);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(projects, null, 2),
          },
        ],
      };
    } catch (error: any) {
      return this.createErrorResponse(
        `Failed to list projects: ${error?.message || 'Unknown error'}`,
        [
          'Ensure the directory exists and is accessible',
          'Check if you have permission to read the directory',
        ]
      );
    }
  }

  /**
   * Get the structure of a Godot project asynchronously by counting files recursively
   * @param projectPath Path to the Godot project
   * @returns Promise resolving to an object with counts of scenes, scripts, assets, and other files
   */
  private getProjectStructureAsync(projectPath: string): Promise<any> {
    return new Promise((resolve) => {
      try {
        const structure = {
          scenes: 0,
          scripts: 0,
          assets: 0,
          other: 0,
        };

        const scanDirectory = (currentPath: string) => {
          const entries = readdirSync(currentPath, { withFileTypes: true });
          
          for (const entry of entries) {
            const entryPath = join(currentPath, entry.name);
            
            // Skip hidden files and directories
            if (entry.name.startsWith('.')) {
              continue;
            }
            
            if (entry.isDirectory()) {
              // Recursively scan subdirectories
              scanDirectory(entryPath);
            } else if (entry.isFile()) {
              // Count file by extension
              const ext = entry.name.split('.').pop()?.toLowerCase();
              
              if (ext === 'tscn') {
                structure.scenes++;
              } else if (ext === 'gd' || ext === 'gdscript' || ext === 'cs') {
                structure.scripts++;
              } else if (['png', 'jpg', 'jpeg', 'webp', 'svg', 'ttf', 'wav', 'mp3', 'ogg'].includes(ext || '')) {
                structure.assets++;
              } else {
                structure.other++;
              }
            }
          }
        };
        
        // Start scanning from the project root
        scanDirectory(projectPath);
        resolve(structure);
      } catch (error) {
        this.logDebug(`Error getting project structure asynchronously: ${error}`);
        resolve({ 
          error: 'Failed to get project structure',
          scenes: 0,
          scripts: 0,
          assets: 0,
          other: 0
        });
      }
    });
  }

  /**
   * Handle the get_project_info tool
   */
  private async handleGetProjectInfo(args: any) {
    // Normalize parameters to camelCase
    args = this.normalizeParameters(args);
    
    if (!args.projectPath) {
      return this.createErrorResponse(
        'Project path is required',
        ['Provide a valid path to a Godot project directory']
      );
    }
  
    if (!this.validatePath(args.projectPath)) {
      return this.createErrorResponse(
        'Invalid project path',
        ['Provide a valid path without ".." or other potentially unsafe characters']
      );
    }
  
    try {
      // Ensure godotPath is set
      if (!this.godotPath) {
        await this.detectGodotPath();
        if (!this.godotPath) {
          return this.createErrorResponse(
            'Could not find a valid Godot executable path',
            [
              'Ensure Godot is installed correctly',
              'Set GODOT_PATH environment variable to specify the correct path',
            ]
          );
        }
      }
  
      // Check if the project directory exists and contains a project.godot file
      const projectFile = join(args.projectPath, 'project.godot');
      if (!existsSync(projectFile)) {
        return this.createErrorResponse(
          `Not a valid Godot project: ${args.projectPath}`,
          [
            'Ensure the path points to a directory containing a project.godot file',
            'Use list_projects to find valid Godot projects',
          ]
        );
      }
  
      this.logDebug(`Getting project info for: ${args.projectPath}`);
  
      // Get Godot version
      const execOptions = { timeout: 10000 }; // 10 second timeout
      const { stdout } = await execAsync(`"${this.godotPath}" --version`, execOptions);
  
      // Get project structure using the recursive method
      const projectStructure = await this.getProjectStructureAsync(args.projectPath);
  
      // Extract project name from project.godot file
      let projectName = basename(args.projectPath);
      try {
        const fs = require('fs');
        const projectFileContent = fs.readFileSync(projectFile, 'utf8');
        const configNameMatch = projectFileContent.match(/config\/name="([^"]+)"/);
        if (configNameMatch && configNameMatch[1]) {
          projectName = configNameMatch[1];
          this.logDebug(`Found project name in config: ${projectName}`);
        }
      } catch (error) {
        this.logDebug(`Error reading project file: ${error}`);
        // Continue with default project name if extraction fails
      }
  
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                name: projectName,
                path: args.projectPath,
                godotVersion: stdout.trim(),
                structure: projectStructure,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error: any) {
      return this.createErrorResponse(
        `Failed to get project info: ${error?.message || 'Unknown error'}`,
        [
          'Ensure Godot is installed correctly',
          'Check if the GODOT_PATH environment variable is set correctly',
          'Verify the project path is accessible',
        ]
      );
    }
  }

  /**
   * Handle the create_scene tool
   */
  private async handleCreateScene(args: any) {
    // Normalize parameters to camelCase
    args = this.normalizeParameters(args);
    
    if (!args.projectPath || !args.scenePath) {
      return this.createErrorResponse(
        'Project path and scene path are required',
        ['Provide valid paths for both the project and the scene']
      );
    }

    if (!this.validatePath(args.projectPath) || !this.validatePath(args.scenePath)) {
      return this.createErrorResponse(
        'Invalid path',
        ['Provide valid paths without ".." or other potentially unsafe characters']
      );
    }

    try {
      // Check if the project directory exists and contains a project.godot file
      const projectFile = join(args.projectPath, 'project.godot');
      if (!existsSync(projectFile)) {
        return this.createErrorResponse(
          `Not a valid Godot project: ${args.projectPath}`,
          [
            'Ensure the path points to a directory containing a project.godot file',
            'Use list_projects to find valid Godot projects',
          ]
        );
      }

      // Prepare parameters for the operation (already in camelCase)
      const params = {
        scenePath: args.scenePath,
        rootNodeType: args.rootNodeType || 'Node2D',
      };

      // Execute the operation
      const { stdout, stderr } = await this.executeOperation('create_scene', params, args.projectPath);

      if (stderr && stderr.includes('Failed to')) {
        return this.createErrorResponse(
          `Failed to create scene: ${stderr}`,
          [
            'Check if the root node type is valid',
            'Ensure you have write permissions to the scene path',
            'Verify the scene path is valid',
          ]
        );
      }

      return {
        content: [
          {
            type: 'text',
            text: `Scene created successfully at: ${args.scenePath}\n\nOutput: ${stdout}`,
          },
        ],
      };
    } catch (error: any) {
      return this.createErrorResponse(
        `Failed to create scene: ${error?.message || 'Unknown error'}`,
        [
          'Ensure Godot is installed correctly',
          'Check if the GODOT_PATH environment variable is set correctly',
          'Verify the project path is accessible',
        ]
      );
    }
  }

  /**
   * Handle the add_node tool
   */
  private async handleAddNode(args: any) {
    // Normalize parameters to camelCase
    args = this.normalizeParameters(args);
    
    if (!args.projectPath || !args.scenePath || !args.nodeType || !args.nodeName) {
      return this.createErrorResponse(
        'Missing required parameters',
        ['Provide projectPath, scenePath, nodeType, and nodeName']
      );
    }

    if (!this.validatePath(args.projectPath) || !this.validatePath(args.scenePath)) {
      return this.createErrorResponse(
        'Invalid path',
        ['Provide valid paths without ".." or other potentially unsafe characters']
      );
    }

    try {
      // Check if the project directory exists and contains a project.godot file
      const projectFile = join(args.projectPath, 'project.godot');
      if (!existsSync(projectFile)) {
        return this.createErrorResponse(
          `Not a valid Godot project: ${args.projectPath}`,
          [
            'Ensure the path points to a directory containing a project.godot file',
            'Use list_projects to find valid Godot projects',
          ]
        );
      }

      // Check if the scene file exists
      const scenePath = join(args.projectPath, args.scenePath);
      if (!existsSync(scenePath)) {
        return this.createErrorResponse(
          `Scene file does not exist: ${args.scenePath}`,
          [
            'Ensure the scene path is correct',
            'Use create_scene to create a new scene first',
          ]
        );
      }

      // Prepare parameters for the operation (already in camelCase)
      const params: any = {
        scenePath: args.scenePath,
        nodeType: args.nodeType,
        nodeName: args.nodeName,
      };

      // Add optional parameters
      if (args.parentNodePath) {
        params.parentNodePath = args.parentNodePath;
      }

      if (args.properties) {
        params.properties = args.properties;
      }

      // Execute the operation
      const { stdout, stderr } = await this.executeOperation('add_node', params, args.projectPath);

      if (stderr && stderr.includes('Failed to')) {
        return this.createErrorResponse(
          `Failed to add node: ${stderr}`,
          [
            'Check if the node type is valid',
            'Ensure the parent node path exists',
            'Verify the scene file is valid',
          ]
        );
      }

      return {
        content: [
          {
            type: 'text',
            text: `Node '${args.nodeName}' of type '${args.nodeType}' added successfully to '${args.scenePath}'.\n\nOutput: ${stdout}`,
          },
        ],
      };
    } catch (error: any) {
      return this.createErrorResponse(
        `Failed to add node: ${error?.message || 'Unknown error'}`,
        [
          'Ensure Godot is installed correctly',
          'Check if the GODOT_PATH environment variable is set correctly',
          'Verify the project path is accessible',
        ]
      );
    }
  }

  /**
   * Handle the load_sprite tool
   */
  private async handleLoadSprite(args: any) {
    // Normalize parameters to camelCase
    args = this.normalizeParameters(args);
    
    if (!args.projectPath || !args.scenePath || !args.nodePath || !args.texturePath) {
      return this.createErrorResponse(
        'Missing required parameters',
        ['Provide projectPath, scenePath, nodePath, and texturePath']
      );
    }

    if (
      !this.validatePath(args.projectPath) ||
      !this.validatePath(args.scenePath) ||
      !this.validatePath(args.nodePath) ||
      !this.validatePath(args.texturePath)
    ) {
      return this.createErrorResponse(
        'Invalid path',
        ['Provide valid paths without ".." or other potentially unsafe characters']
      );
    }

    try {
      // Check if the project directory exists and contains a project.godot file
      const projectFile = join(args.projectPath, 'project.godot');
      if (!existsSync(projectFile)) {
        return this.createErrorResponse(
          `Not a valid Godot project: ${args.projectPath}`,
          [
            'Ensure the path points to a directory containing a project.godot file',
            'Use list_projects to find valid Godot projects',
          ]
        );
      }

      // Check if the scene file exists
      const scenePath = join(args.projectPath, args.scenePath);
      if (!existsSync(scenePath)) {
        return this.createErrorResponse(
          `Scene file does not exist: ${args.scenePath}`,
          [
            'Ensure the scene path is correct',
            'Use create_scene to create a new scene first',
          ]
        );
      }

      // Check if the texture file exists
      const texturePath = join(args.projectPath, args.texturePath);
      if (!existsSync(texturePath)) {
        return this.createErrorResponse(
          `Texture file does not exist: ${args.texturePath}`,
          [
            'Ensure the texture path is correct',
            'Upload or create the texture file first',
          ]
        );
      }

      // Prepare parameters for the operation (already in camelCase)
      const params = {
        scenePath: args.scenePath,
        nodePath: args.nodePath,
        texturePath: args.texturePath,
      };

      // Execute the operation
      const { stdout, stderr } = await this.executeOperation('load_sprite', params, args.projectPath);

      if (stderr && stderr.includes('Failed to')) {
        return this.createErrorResponse(
          `Failed to load sprite: ${stderr}`,
          [
            'Check if the node path is correct',
            'Ensure the node is a Sprite2D, Sprite3D, or TextureRect',
            'Verify the texture file is a valid image format',
          ]
        );
      }

      return {
        content: [
          {
            type: 'text',
            text: `Sprite loaded successfully with texture: ${args.texturePath}\n\nOutput: ${stdout}`,
          },
        ],
      };
    } catch (error: any) {
      return this.createErrorResponse(
        `Failed to load sprite: ${error?.message || 'Unknown error'}`,
        [
          'Ensure Godot is installed correctly',
          'Check if the GODOT_PATH environment variable is set correctly',
          'Verify the project path is accessible',
        ]
      );
    }
  }

  /**
   * Handle the export_mesh_library tool
   */
  private async handleExportMeshLibrary(args: any) {
    // Normalize parameters to camelCase
    args = this.normalizeParameters(args);
    
    if (!args.projectPath || !args.scenePath || !args.outputPath) {
      return this.createErrorResponse(
        'Missing required parameters',
        ['Provide projectPath, scenePath, and outputPath']
      );
    }

    if (
      !this.validatePath(args.projectPath) ||
      !this.validatePath(args.scenePath) ||
      !this.validatePath(args.outputPath)
    ) {
      return this.createErrorResponse(
        'Invalid path',
        ['Provide valid paths without ".." or other potentially unsafe characters']
      );
    }

    try {
      // Check if the project directory exists and contains a project.godot file
      const projectFile = join(args.projectPath, 'project.godot');
      if (!existsSync(projectFile)) {
        return this.createErrorResponse(
          `Not a valid Godot project: ${args.projectPath}`,
          [
            'Ensure the path points to a directory containing a project.godot file',
            'Use list_projects to find valid Godot projects',
          ]
        );
      }

      // Check if the scene file exists
      const scenePath = join(args.projectPath, args.scenePath);
      if (!existsSync(scenePath)) {
        return this.createErrorResponse(
          `Scene file does not exist: ${args.scenePath}`,
          [
            'Ensure the scene path is correct',
            'Use create_scene to create a new scene first',
          ]
        );
      }

      // Prepare parameters for the operation (already in camelCase)
      const params: any = {
        scenePath: args.scenePath,
        outputPath: args.outputPath,
      };

      // Add optional parameters
      if (args.meshItemNames && Array.isArray(args.meshItemNames)) {
        params.meshItemNames = args.meshItemNames;
      }

      // Execute the operation
      const { stdout, stderr } = await this.executeOperation('export_mesh_library', params, args.projectPath);

      if (stderr && stderr.includes('Failed to')) {
        return this.createErrorResponse(
          `Failed to export mesh library: ${stderr}`,
          [
            'Check if the scene contains valid 3D meshes',
            'Ensure the output path is valid',
            'Verify the scene file is valid',
          ]
        );
      }

      return {
        content: [
          {
            type: 'text',
            text: `MeshLibrary exported successfully to: ${args.outputPath}\n\nOutput: ${stdout}`,
          },
        ],
      };
    } catch (error: any) {
      return this.createErrorResponse(
        `Failed to export mesh library: ${error?.message || 'Unknown error'}`,
        [
          'Ensure Godot is installed correctly',
          'Check if the GODOT_PATH environment variable is set correctly',
          'Verify the project path is accessible',
        ]
      );
    }
  }

  /**
   * Handle the save_scene tool
   */
  private async handleSaveScene(args: any) {
    // Normalize parameters to camelCase
    args = this.normalizeParameters(args);
    
    if (!args.projectPath || !args.scenePath) {
      return this.createErrorResponse(
        'Missing required parameters',
        ['Provide projectPath and scenePath']
      );
    }

    if (!this.validatePath(args.projectPath) || !this.validatePath(args.scenePath)) {
      return this.createErrorResponse(
        'Invalid path',
        ['Provide valid paths without ".." or other potentially unsafe characters']
      );
    }

    // If newPath is provided, validate it
    if (args.newPath && !this.validatePath(args.newPath)) {
      return this.createErrorResponse(
        'Invalid new path',
        ['Provide a valid new path without ".." or other potentially unsafe characters']
      );
    }

    try {
      // Check if the project directory exists and contains a project.godot file
      const projectFile = join(args.projectPath, 'project.godot');
      if (!existsSync(projectFile)) {
        return this.createErrorResponse(
          `Not a valid Godot project: ${args.projectPath}`,
          [
            'Ensure the path points to a directory containing a project.godot file',
            'Use list_projects to find valid Godot projects',
          ]
        );
      }

      // Check if the scene file exists
      const scenePath = join(args.projectPath, args.scenePath);
      if (!existsSync(scenePath)) {
        return this.createErrorResponse(
          `Scene file does not exist: ${args.scenePath}`,
          [
            'Ensure the scene path is correct',
            'Use create_scene to create a new scene first',
          ]
        );
      }

      // Prepare parameters for the operation (already in camelCase)
      const params: any = {
        scenePath: args.scenePath,
      };

      // Add optional parameters
      if (args.newPath) {
        params.newPath = args.newPath;
      }

      // Execute the operation
      const { stdout, stderr } = await this.executeOperation('save_scene', params, args.projectPath);

      if (stderr && stderr.includes('Failed to')) {
        return this.createErrorResponse(
          `Failed to save scene: ${stderr}`,
          [
            'Check if the scene file is valid',
            'Ensure you have write permissions to the output path',
            'Verify the scene can be properly packed',
          ]
        );
      }

      const savePath = args.newPath || args.scenePath;
      return {
        content: [
          {
            type: 'text',
            text: `Scene saved successfully to: ${savePath}\n\nOutput: ${stdout}`,
          },
        ],
      };
    } catch (error: any) {
      return this.createErrorResponse(
        `Failed to save scene: ${error?.message || 'Unknown error'}`,
        [
          'Ensure Godot is installed correctly',
          'Check if the GODOT_PATH environment variable is set correctly',
          'Verify the project path is accessible',
        ]
      );
    }
  }

  /**
   * Handle the get_uid tool
   */
  private async handleGetUid(args: any) {
    // Normalize parameters to camelCase
    args = this.normalizeParameters(args);
    
    if (!args.projectPath || !args.filePath) {
      return this.createErrorResponse(
        'Missing required parameters',
        ['Provide projectPath and filePath']
      );
    }

    if (!this.validatePath(args.projectPath) || !this.validatePath(args.filePath)) {
      return this.createErrorResponse(
        'Invalid path',
        ['Provide valid paths without ".." or other potentially unsafe characters']
      );
    }

    try {
      // Ensure godotPath is set
      if (!this.godotPath) {
        await this.detectGodotPath();
        if (!this.godotPath) {
          return this.createErrorResponse(
            'Could not find a valid Godot executable path',
            [
              'Ensure Godot is installed correctly',
              'Set GODOT_PATH environment variable to specify the correct path',
            ]
          );
        }
      }

      // Check if the project directory exists and contains a project.godot file
      const projectFile = join(args.projectPath, 'project.godot');
      if (!existsSync(projectFile)) {
        return this.createErrorResponse(
          `Not a valid Godot project: ${args.projectPath}`,
          [
            'Ensure the path points to a directory containing a project.godot file',
            'Use list_projects to find valid Godot projects',
          ]
        );
      }

      // Check if the file exists
      const filePath = join(args.projectPath, args.filePath);
      if (!existsSync(filePath)) {
        return this.createErrorResponse(
          `File does not exist: ${args.filePath}`,
          ['Ensure the file path is correct']
        );
      }

      // Get Godot version to check if UIDs are supported
      const { stdout: versionOutput } = await execAsync(`"${this.godotPath}" --version`);
      const version = versionOutput.trim();

      if (!this.isGodot44OrLater(version)) {
        return this.createErrorResponse(
          `UIDs are only supported in Godot 4.4 or later. Current version: ${version}`,
          [
            'Upgrade to Godot 4.4 or later to use UIDs',
            'Use resource paths instead of UIDs for this version of Godot',
          ]
        );
      }

      // Prepare parameters for the operation (already in camelCase)
      const params = {
        filePath: args.filePath,
      };

      // Execute the operation
      const { stdout, stderr } = await this.executeOperation('get_uid', params, args.projectPath);

      if (stderr && stderr.includes('Failed to')) {
        return this.createErrorResponse(
          `Failed to get UID: ${stderr}`,
          [
            'Check if the file is a valid Godot resource',
            'Ensure the file path is correct',
          ]
        );
      }

      return {
        content: [
          {
            type: 'text',
            text: `UID for ${args.filePath}: ${stdout.trim()}`,
          },
        ],
      };
    } catch (error: any) {
      return this.createErrorResponse(
        `Failed to get UID: ${error?.message || 'Unknown error'}`,
        [
          'Ensure Godot is installed correctly',
          'Check if the GODOT_PATH environment variable is set correctly',
          'Verify the project path is accessible',
        ]
      );
    }
  }

  /**
   * Handle the update_project_uids tool
   */
  private async handleUpdateProjectUids(args: any) {
    // Normalize parameters to camelCase
    args = this.normalizeParameters(args);
    
    if (!args.projectPath) {
      return this.createErrorResponse(
        'Project path is required',
        ['Provide a valid path to a Godot project directory']
      );
    }

    if (!this.validatePath(args.projectPath)) {
      return this.createErrorResponse(
        'Invalid project path',
        ['Provide a valid path without ".." or other potentially unsafe characters']
      );
    }

    try {
      // Ensure godotPath is set
      if (!this.godotPath) {
        await this.detectGodotPath();
        if (!this.godotPath) {
          return this.createErrorResponse(
            'Could not find a valid Godot executable path',
            [
              'Ensure Godot is installed correctly',
              'Set GODOT_PATH environment variable to specify the correct path',
            ]
          );
        }
      }

      // Check if the project directory exists and contains a project.godot file
      const projectFile = join(args.projectPath, 'project.godot');
      if (!existsSync(projectFile)) {
        return this.createErrorResponse(
          `Not a valid Godot project: ${args.projectPath}`,
          [
            'Ensure the path points to a directory containing a project.godot file',
            'Use list_projects to find valid Godot projects',
          ]
        );
      }

      // Get Godot version to check if UIDs are supported
      const { stdout: versionOutput } = await execAsync(`"${this.godotPath}" --version`);
      const version = versionOutput.trim();

      if (!this.isGodot44OrLater(version)) {
        return this.createErrorResponse(
          `UIDs are only supported in Godot 4.4 or later. Current version: ${version}`,
          [
            'Upgrade to Godot 4.4 or later to use UIDs',
            'Use resource paths instead of UIDs for this version of Godot',
          ]
        );
      }

      // Prepare parameters for the operation (already in camelCase)
      const params = {
        projectPath: args.projectPath,
      };

      // Execute the operation
      const { stdout, stderr } = await this.executeOperation('resave_resources', params, args.projectPath);

      if (stderr && stderr.includes('Failed to')) {
        return this.createErrorResponse(
          `Failed to update project UIDs: ${stderr}`,
          [
            'Check if the project is valid',
            'Ensure you have write permissions to the project directory',
          ]
        );
      }

      return {
        content: [
          {
            type: 'text',
            text: `Project UIDs updated successfully.\n\nOutput: ${stdout}`,
          },
        ],
      };
    } catch (error: any) {
      return this.createErrorResponse(
        `Failed to update project UIDs: ${error?.message || 'Unknown error'}`,
        [
          'Ensure Godot is installed correctly',
          'Check if the GODOT_PATH environment variable is set correctly',
          'Verify the project path is accessible',
        ]
      );
    }
  }

  /**
   * Handle the duplicate_resource_advanced tool
   * @param args Tool arguments
   */
  private async handleDuplicateResourceAdvanced(args: any) {
    // Normalize parameters to camelCase
    args = this.normalizeParameters(args);
    
    if (!args.projectPath || !args.resourcePath) {
      return this.createErrorResponse(
        'Missing required parameters',
        ['Provide projectPath and resourcePath']
      );
    }

    if (!this.validatePath(args.projectPath) || !this.validatePath(args.resourcePath)) {
      return this.createErrorResponse(
        'Invalid path',
        ['Provide valid paths without ".." or other potentially unsafe characters']
      );
    }

    // Validate outputPath if provided
    if (args.outputPath && !this.validatePath(args.outputPath)) {
      return this.createErrorResponse(
        'Invalid output path',
        ['Provide a valid output path without ".." or other potentially unsafe characters']
      );
    }

    try {
      // Check if the project directory exists and contains a project.godot file
      const projectFile = join(args.projectPath, 'project.godot');
      if (!existsSync(projectFile)) {
        return this.createErrorResponse(
          `Not a valid Godot project: ${args.projectPath}`,
          [
            'Ensure the path points to a directory containing a project.godot file',
            'Use list_projects to find valid Godot projects',
          ]
        );
      }

      // Check if the resource file exists
      const resourcePath = join(args.projectPath, args.resourcePath);
      if (!existsSync(resourcePath)) {
        return this.createErrorResponse(
          `Resource file does not exist: ${args.resourcePath}`,
          [
            'Ensure the resource path is correct',
            'Check if the resource file exists in the project',
          ]
        );
      }

      // Get Godot version to check for 4.5+ features
      const { stdout: version } = await this.executeGetGodotVersion();
      const isGodot45Plus = this.isGodot45OrLater(version.trim());
      
      if (args.duplicateExternalResources && !isGodot45Plus) {
        return this.createErrorResponse(
          `External resource duplication requires Godot 4.5+. Current version: ${version.trim()}`,
          [
            'Upgrade to Godot 4.5 or later to use RESOURCE_DEEP_DUPLICATE_ALL',
            'Set duplicateExternalResources to false for Godot 4.4',
          ]
        );
      }

      // Prepare parameters for the operation (already in camelCase)
      const params: any = {
        resourcePath: args.resourcePath,
      };

      // Add optional parameters
      if (args.outputPath) {
        params.outputPath = args.outputPath;
      }
      
      if (args.useDeepDuplication) {
        params.useDeepDuplication = args.useDeepDuplication;
      }
      
      if (args.duplicateExternalResources) {
        params.duplicateExternalResources = args.duplicateExternalResources;
      }

      // Execute the operation
      const { stdout, stderr } = await this.executeOperation('duplicate_resource_advanced', params, args.projectPath);

      if (stderr && stderr.includes('Failed to')) {
        return this.createErrorResponse(
          `Failed to duplicate resource: ${stderr}`,
          [
            'Check if the resource file is valid',
            'Ensure you have write permissions to the output path',
            'Verify the resource can be properly loaded',
          ]
        );
      }

      const operationType = args.duplicateExternalResources 
        ? 'deep duplication with external resources (Godot 4.5+)' 
        : args.useDeepDuplication 
          ? 'deep duplication' 
          : 'standard duplication';
      
      return {
        content: [
          {
            type: 'text',
            text: `Resource duplicated successfully using ${operationType}\n\nOutput: ${stdout}`,
          },
        ],
      };
    } catch (error: any) {
      return this.createErrorResponse(
        `Failed to duplicate resource: ${error?.message || 'Unknown error'}`,
        [
          'Ensure Godot is installed correctly',
          'Check if the GODOT_PATH environment variable is set correctly',
          'Verify the project path is accessible',
        ]
      );
    }
  }

  /**
   * Handle the configure_tilemap_layer tool
   * @param args Tool arguments
   */
  private async handleConfigureTileMapLayer(args: any) {
    // Normalize parameters to camelCase
    args = this.normalizeParameters(args);
    
    if (!args.projectPath || !args.scenePath || !args.tileMapLayerPath) {
      return this.createErrorResponse(
        'Missing required parameters',
        ['Provide projectPath, scenePath, and tileMapLayerPath']
      );
    }

    if (!this.validatePath(args.projectPath) || !this.validatePath(args.scenePath) || !this.validatePath(args.tileMapLayerPath)) {
      return this.createErrorResponse(
        'Invalid path',
        ['Provide valid paths without ".." or other potentially unsafe characters']
      );
    }

    try {
      // Check if the project directory exists and contains a project.godot file
      const projectFile = join(args.projectPath, 'project.godot');
      if (!existsSync(projectFile)) {
        return this.createErrorResponse(
          `Not a valid Godot project: ${args.projectPath}`,
          [
            'Ensure the path points to a directory containing a project.godot file',
            'Use list_projects to find valid Godot projects',
          ]
        );
      }

      // Check if the scene file exists
      const scenePath = join(args.projectPath, args.scenePath);
      if (!existsSync(scenePath)) {
        return this.createErrorResponse(
          `Scene file does not exist: ${args.scenePath}`,
          [
            'Ensure the scene path is correct',
            'Check if the scene file exists in the project',
          ]
        );
      }

      // Get Godot version to provide appropriate warnings about 4.5+ features
      let version = '';
      let isGodot45Plus = false;
      try {
        const { stdout } = await this.executeGetGodotVersion();
        version = stdout.trim();
        isGodot45Plus = this.isGodot45OrLater(version);
      } catch (error) {
        // Version detection failed, continue but note this in response
        version = 'unknown';
      }

      // Prepare parameters for the operation (already in camelCase)
      const params: any = {
        scenePath: args.scenePath,
        tileMapLayerPath: args.tileMapLayerPath,
      };

      // Add optional parameters
      if (args.physicsQuadrantSize !== undefined) {
        params.physicsQuadrantSize = args.physicsQuadrantSize;
      }
      
      if (args.renderingQuadrantSize !== undefined) {
        params.renderingQuadrantSize = args.renderingQuadrantSize;
      }
      
      if (args.collisionEnabled !== undefined) {
        params.collisionEnabled = args.collisionEnabled;
      }
      
      if (args.navigationEnabled !== undefined) {
        params.navigationEnabled = args.navigationEnabled;
      }

      // Execute the operation
      const { stdout, stderr } = await this.executeOperation('configure_tilemap_layer', params, args.projectPath);

      if (stderr && stderr.includes('Failed to')) {
        return this.createErrorResponse(
          `Failed to configure TileMapLayer: ${stderr}`,
          [
            'Check if the TileMapLayer node exists at the specified path',
            'Ensure the scene file is valid and accessible',
            'Verify you have write permissions to save the scene',
          ]
        );
      }

      let versionNote = '';
      if (!isGodot45Plus) {
        versionNote = ` Note: Some advanced features like physics_quadrant_size require Godot 4.5+. Current version: ${version}`;
      }

      return {
        content: [
          {
            type: 'text',
            text: `TileMapLayer configured successfully!\n\nOutput: ${stdout}${versionNote}`,
          },
        ],
      };
    } catch (error: any) {
      return this.createErrorResponse(
        `Failed to configure TileMapLayer: ${error?.message || 'Unknown error'}`,
        [
          'Ensure Godot is installed correctly',
          'Check if the GODOT_PATH environment variable is set correctly',
          'Verify the project path is accessible',
        ]
      );
    }
  }

  /**
   * Handle the create_foldable_container tool
   * @param args Tool arguments
   */
  private async handleCreateFoldableContainer(args: any) {
    // Normalize parameters to camelCase
    args = this.normalizeParameters(args);
    
    if (!args.projectPath || !args.scenePath || !args.nodeName) {
      return this.createErrorResponse(
        'Missing required parameters',
        ['Provide projectPath, scenePath, and nodeName']
      );
    }

    if (!this.validatePath(args.projectPath) || !this.validatePath(args.scenePath)) {
      return this.createErrorResponse(
        'Invalid path',
        ['Provide valid paths without ".." or other potentially unsafe characters']
      );
    }

    try {
      // Check if the project directory exists and contains a project.godot file
      const projectFile = join(args.projectPath, 'project.godot');
      if (!existsSync(projectFile)) {
        return this.createErrorResponse(
          `Not a valid Godot project: ${args.projectPath}`,
          [
            'Ensure the path points to a directory containing a project.godot file',
            'Use list_projects to find valid Godot projects',
          ]
        );
      }

      // Check if the scene file exists
      const scenePath = join(args.projectPath, args.scenePath);
      if (!existsSync(scenePath)) {
        return this.createErrorResponse(
          `Scene file does not exist: ${args.scenePath}`,
          [
            'Ensure the scene path is correct',
            'Check if the scene file exists in the project',
          ]
        );
      }

      // Get Godot version to check for 4.5+ features
      let version = '';
      let isGodot45Plus = false;
      try {
        const { stdout } = await this.executeGetGodotVersion();
        version = stdout.trim();
        isGodot45Plus = this.isGodot45OrLater(version);
      } catch (error) {
        // Version detection failed, continue but note this in response
        version = 'unknown';
      }

      // Warn if using older Godot version
      if (!isGodot45Plus) {
        return this.createErrorResponse(
          `FoldableContainer requires Godot 4.5+. Current version: ${version}`,
          [
            'Upgrade to Godot 4.5 or later to use FoldableContainer',
            'Consider using a regular Container with custom folding behavior for older versions',
          ]
        );
      }

      // Prepare parameters for the operation (already in camelCase)
      const params: any = {
        scenePath: args.scenePath,
        nodeName: args.nodeName,
      };

      // Add optional parameters
      if (args.parentNodePath) {
        params.parentNodePath = args.parentNodePath;
      }
      
      if (args.title) {
        params.title = args.title;
      }
      
      if (args.folded !== undefined) {
        params.folded = args.folded;
      }
      
      if (args.toggleMode !== undefined) {
        params.toggleMode = args.toggleMode;
      }

      // Execute the operation
      const { stdout, stderr } = await this.executeOperation('create_foldable_container', params, args.projectPath);

      if (stderr && stderr.includes('Failed to')) {
        return this.createErrorResponse(
          `Failed to create FoldableContainer: ${stderr}`,
          [
            'Check if the parent node exists at the specified path',
            'Ensure the scene file is valid and accessible',
            'Verify you have write permissions to save the scene',
          ]
        );
      }

      return {
        content: [
          {
            type: 'text',
            text: `FoldableContainer created successfully!\n\nOutput: ${stdout}`,
          },
        ],
      };
    } catch (error: any) {
      return this.createErrorResponse(
        `Failed to create FoldableContainer: ${error?.message || 'Unknown error'}`,
        [
          'Ensure Godot is installed correctly',
          'Check if the GODOT_PATH environment variable is set correctly',
          'Verify the project path is accessible',
        ]
      );
    }
  }

  /**
   * Handle the configure_navigation_async tool
   * @param args Tool arguments
   */
  private async handleConfigureNavigationAsync(args: any) {
    // Normalize parameters to camelCase
    args = this.normalizeParameters(args);
    
    if (!args.projectPath) {
      return this.createErrorResponse(
        'Missing required parameters',
        ['Provide projectPath']
      );
    }

    if (!this.validatePath(args.projectPath)) {
      return this.createErrorResponse(
        'Invalid path',
        ['Provide valid paths without ".." or other potentially unsafe characters']
      );
    }

    try {
      // Check if the project directory exists and contains a project.godot file
      const projectFile = join(args.projectPath, 'project.godot');
      if (!existsSync(projectFile)) {
        return this.createErrorResponse(
          `Not a valid Godot project: ${args.projectPath}`,
          [
            'Ensure the path points to a directory containing a project.godot file',
            'Use list_projects to find valid Godot projects',
          ]
        );
      }

      // Get Godot version to check for 4.5+ features
      let version = '';
      let isGodot45Plus = false;
      try {
        const { stdout } = await this.executeGetGodotVersion();
        version = stdout.trim();
        isGodot45Plus = this.isGodot45OrLater(version);
      } catch (error) {
        // Version detection failed, continue but note this in response
        version = 'unknown';
      }

      // Warn about version compatibility
      let versionWarning = '';
      if (!isGodot45Plus) {
        versionWarning = ` Note: Asynchronous navigation updates are optimized for Godot 4.5+. Current version: ${version}`;
      }

      // Validate cell scale parameter
      if (args.mergeRasterizerCellScale !== undefined) {
        const cellScale = parseFloat(args.mergeRasterizerCellScale);
        if (isNaN(cellScale) || cellScale < 0.01 || cellScale > 1.0) {
          return this.createErrorResponse(
            'Invalid mergeRasterizerCellScale value',
            ['Cell scale must be between 0.01 and 1.0']
          );
        }
      }

      // Prepare parameters for the operation (already in camelCase)
      const params: any = {};

      // Add optional parameters
      if (args.enableAsyncRegionUpdates !== undefined) {
        params.enableAsyncRegionUpdates = args.enableAsyncRegionUpdates;
      }
      
      if (args.mergeRasterizerCellScale !== undefined) {
        params.mergeRasterizerCellScale = args.mergeRasterizerCellScale;
      }
      
      if (args.applyToProject !== undefined) {
        params.applyToProject = args.applyToProject;
      }

      // Execute the operation
      const { stdout, stderr } = await this.executeOperation('configure_navigation_async', params, args.projectPath);

      if (stderr && stderr.includes('Failed to')) {
        return this.createErrorResponse(
          `Failed to configure NavigationServer: ${stderr}`,
          [
            'Check if the project supports NavigationServer configuration',
            'Ensure you have write permissions to save project settings',
            'Verify the project.godot file is accessible',
          ]
        );
      }

      return {
        content: [
          {
            type: 'text',
            text: `NavigationServer configured successfully!\n\nOutput: ${stdout}${versionWarning}`,
          },
        ],
      };
    } catch (error: any) {
      return this.createErrorResponse(
        `Failed to configure NavigationServer: ${error?.message || 'Unknown error'}`,
        [
          'Ensure Godot is installed correctly',
          'Check if the GODOT_PATH environment variable is set correctly',
          'Verify the project path is accessible',
        ]
      );
    }
  }

  /**
   * Handle the audit_migration_45 tool
   * @param args Tool arguments
   */
  private async handleAuditMigration45(args: any) {
    // Normalize parameters to camelCase
    args = this.normalizeParameters(args);

    if (!args.projectPath) {
      return this.createErrorResponse(
        'Missing required parameters',
        ['Provide projectPath']
      );
    }

    if (!this.validatePath(args.projectPath)) {
      return this.createErrorResponse(
        'Invalid path',
        ['Provide valid projectPath without ".." or other unsafe characters']
      );
    }

    try {
      // Check if the project directory exists and contains a project.godot file
      const projectFile = join(args.projectPath, 'project.godot');
      if (!existsSync(projectFile)) {
        return this.createErrorResponse(
          `Not a valid Godot project: ${args.projectPath}`,
          [
            'Ensure the path points to a directory containing a project.godot file',
            'Use list_projects to find valid Godot projects',
          ]
        );
      }

      // Prepare parameters
      const params: any = {};
      if (args.includePatterns) params.includePatterns = args.includePatterns;

      const { stdout, stderr } = await this.executeOperation('audit_migration_45', params, args.projectPath);

      if (stderr && stderr.includes('Failed to')) {
        return this.createErrorResponse(
          `Failed to audit project: ${stderr}`,
          [
            'Verify files are readable',
            'Ensure the project directory is accessible',
          ]
        );
      }

      // stdout is expected to be JSON from the Godot script
      let parsed: any = null;
      try {
        parsed = JSON.parse(stdout.trim());
      } catch (_e) {
        // If parsing fails, still return raw output
        parsed = { raw: stdout.trim(), parse_error: 'Failed to parse JSON output from audit script' };
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(parsed, null, 2)
          }
        ]
      };
    } catch (error: any) {
      return this.createErrorResponse(
        `Failed to run migration audit: ${error?.message || 'Unknown error'}`,
        [
          'Ensure Godot is installed correctly',
          'Check if the GODOT_PATH environment variable is set correctly',
          'Verify the project path is accessible'
        ]
      );
    }
  }

  /**
   * Handle the audit_scripts_gd tool
   */
  private async handleAuditScriptsGd(args: any) {
    args = this.normalizeParameters(args);
    if (!args.projectPath) {
      return this.createErrorResponse('Missing required parameters', ['Provide projectPath']);
    }
    if (!this.validatePath(args.projectPath)) {
      return this.createErrorResponse('Invalid path', ['Provide a safe projectPath']);
    }
    try {
      const projectFile = join(args.projectPath, 'project.godot');
      if (!existsSync(projectFile)) {
        return this.createErrorResponse(`Not a valid Godot project: ${args.projectPath}`, ['Ensure project.godot exists']);
      }
      const params: any = {};
      if (args.includePatterns) params.includePatterns = args.includePatterns;
      if (args.maxFindingsPerFile !== undefined) params.maxFindingsPerFile = args.maxFindingsPerFile;
      const { stdout, stderr } = await this.executeOperation('audit_scripts_gd', params, args.projectPath);
      if (stderr && stderr.includes('Failed to')) {
        return this.createErrorResponse(`Failed to audit GDScript: ${stderr}`, ['Check file permissions']);
      }
      let parsed: any;
      try { parsed = JSON.parse(stdout.trim()); } catch { parsed = { raw: stdout.trim(), parse_error: 'JSON parse failed' }; }
      return { content: [{ type: 'text', text: JSON.stringify(parsed, null, 2) }] };
    } catch (error: any) {
      return this.createErrorResponse(`Failed to run GDScript audit: ${error?.message || 'Unknown error'}`);
    }
  }

  /**
   * Handle the audit_scripts_cs tool
   */
  private async handleAuditScriptsCs(args: any) {
    args = this.normalizeParameters(args);
    if (!args.projectPath) {
      return this.createErrorResponse('Missing required parameters', ['Provide projectPath']);
    }
    if (!this.validatePath(args.projectPath)) {
      return this.createErrorResponse('Invalid path', ['Provide a safe projectPath']);
    }
    try {
      const projectFile = join(args.projectPath, 'project.godot');
      if (!existsSync(projectFile)) {
        return this.createErrorResponse(`Not a valid Godot project: ${args.projectPath}`, ['Ensure project.godot exists']);
      }
      const params: any = {};
      if (args.includePatterns) params.includePatterns = args.includePatterns;
      if (args.maxFindingsPerFile !== undefined) params.maxFindingsPerFile = args.maxFindingsPerFile;
      const { stdout, stderr } = await this.executeOperation('audit_scripts_cs', params, args.projectPath);
      if (stderr && stderr.includes('Failed to')) {
        return this.createErrorResponse(`Failed to audit C# scripts: ${stderr}`, ['Check file permissions']);
      }
      let parsed: any;
      try { parsed = JSON.parse(stdout.trim()); } catch { parsed = { raw: stdout.trim(), parse_error: 'JSON parse failed' }; }
      return { content: [{ type: 'text', text: JSON.stringify(parsed, null, 2) }] };
    } catch (error: any) {
      return this.createErrorResponse(`Failed to run C# script audit: ${error?.message || 'Unknown error'}`);
    }
  }

  /**
   * Handle the scene_smoke_test tool
   */
  private async handleSceneSmokeTest(args: any) {
    args = this.normalizeParameters(args);
    if (!args.projectPath) {
      return this.createErrorResponse('Missing required parameters', ['Provide projectPath']);
    }
    if (!this.validatePath(args.projectPath)) {
      return this.createErrorResponse('Invalid path', ['Provide a safe projectPath']);
    }
    try {
      const projectFile = join(args.projectPath, 'project.godot');
      if (!existsSync(projectFile)) {
        return this.createErrorResponse(`Not a valid Godot project: ${args.projectPath}`, ['Ensure project.godot exists']);
      }
      const params: any = {};
      if (args.includePatterns) params.includePatterns = args.includePatterns;
      if (args.instantiate !== undefined) params.instantiate = args.instantiate;
      if (args.maxScenes !== undefined) params.maxScenes = args.maxScenes;
      const { stdout, stderr } = await this.executeOperation('scene_smoke_test', params, args.projectPath);
      if (stderr && stderr.includes('Failed to')) {
        return this.createErrorResponse(`Failed to execute scene smoke test: ${stderr}`);
      }
      let parsed: any;
      try { parsed = JSON.parse(stdout.trim()); } catch { parsed = { raw: stdout.trim(), parse_error: 'JSON parse failed' }; }
      return { content: [{ type: 'text', text: JSON.stringify(parsed, null, 2) }] };
    } catch (error: any) {
      return this.createErrorResponse(`Failed to run scene smoke test: ${error?.message || 'Unknown error'}`);
    }
  }

  /**
   * Handle the validate_export_presets tool
   */
  private async handleValidateExportPresets(args: any) {
    args = this.normalizeParameters(args);
    if (!args.projectPath) {
      return this.createErrorResponse('Missing required parameters', ['Provide projectPath']);
    }
    if (!this.validatePath(args.projectPath)) {
      return this.createErrorResponse('Invalid path', ['Provide a safe projectPath']);
    }
    try {
      const projectFile = join(args.projectPath, 'project.godot');
      if (!existsSync(projectFile)) {
        return this.createErrorResponse(`Not a valid Godot project: ${args.projectPath}`, ['Ensure project.godot exists']);
      }
      const params: any = {}; // no extra params currently
      const { stdout, stderr } = await this.executeOperation('validate_export_presets', params, args.projectPath);
      if (stderr && stderr.includes('Failed to')) {
        return this.createErrorResponse(`Failed to validate export presets: ${stderr}`);
      }
      let parsed: any;
      try { parsed = JSON.parse(stdout.trim()); } catch { parsed = { raw: stdout.trim(), parse_error: 'JSON parse failed' }; }
      return { content: [{ type: 'text', text: JSON.stringify(parsed, null, 2) }] };
    } catch (error: any) {
      return this.createErrorResponse(`Failed to run export preset validation: ${error?.message || 'Unknown error'}`);
    }
  }

  /**
   * Handle the input_map_audit tool
   */
  private async handleInputMapAudit(args: any) {
    args = this.normalizeParameters(args);
    if (!args.projectPath) {
      return this.createErrorResponse('Missing required parameters', ['Provide projectPath']);
    }
    if (!this.validatePath(args.projectPath)) {
      return this.createErrorResponse('Invalid path', ['Provide a safe projectPath']);
    }
    try {
      const projectFile = join(args.projectPath, 'project.godot');
      if (!existsSync(projectFile)) {
        return this.createErrorResponse(`Not a valid Godot project: ${args.projectPath}`, ['Ensure project.godot exists']);
      }
      const params: any = {};
      const { stdout, stderr } = await this.executeOperation('input_map_audit', params, args.projectPath);
      if (stderr && stderr.includes('Failed to')) {
        return this.createErrorResponse(`Failed to audit InputMap: ${stderr}`);
      }
      let parsed: any;
      try { parsed = JSON.parse(stdout.trim()); } catch { parsed = { raw: stdout.trim(), parse_error: 'JSON parse failed' }; }
      return { content: [{ type: 'text', text: JSON.stringify(parsed, null, 2) }] };
    } catch (error: any) {
      return this.createErrorResponse(`Failed to run InputMap audit: ${error?.message || 'Unknown error'}`);
    }
  }

  /**
   * Handle the physics_layer_audit tool
   */
  private async handlePhysicsLayerAudit(args: any) {
    args = this.normalizeParameters(args);
    if (!args.projectPath) {
      return this.createErrorResponse('Missing required parameters', ['Provide projectPath']);
    }
    if (!this.validatePath(args.projectPath)) {
      return this.createErrorResponse('Invalid path', ['Provide a safe projectPath']);
    }
    try {
      const projectFile = join(args.projectPath, 'project.godot');
      if (!existsSync(projectFile)) {
        return this.createErrorResponse(`Not a valid Godot project: ${args.projectPath}`, ['Ensure project.godot exists']);
      }
      const params: any = {};
      const { stdout, stderr } = await this.executeOperation('physics_layer_audit', params, args.projectPath);
      if (stderr && stderr.includes('Failed to')) {
        return this.createErrorResponse(`Failed to audit physics layers: ${stderr}`);
      }
      let parsed: any;
      try { parsed = JSON.parse(stdout.trim()); } catch { parsed = { raw: stdout.trim(), parse_error: 'JSON parse failed' }; }
      return { content: [{ type: 'text', text: JSON.stringify(parsed, null, 2) }] };
    } catch (error: any) {
      return this.createErrorResponse(`Failed to run physics layer audit: ${error?.message || 'Unknown error'}`);
    }
  }

  /**
   * Handle the audio_bus_layout_audit tool
   */
  private async handleAudioBusLayoutAudit(args: any) {
    args = this.normalizeParameters(args);
    if (!args.projectPath) {
      return this.createErrorResponse('Missing required parameters', ['Provide projectPath']);
    }
    if (!this.validatePath(args.projectPath)) {
      return this.createErrorResponse('Invalid path', ['Provide a safe projectPath']);
    }
    try {
      const projectFile = join(args.projectPath, 'project.godot');
      if (!existsSync(projectFile)) {
        return this.createErrorResponse(`Not a valid Godot project: ${args.projectPath}`, ['Ensure project.godot exists']);
      }
      const params: any = {};
      const { stdout, stderr } = await this.executeOperation('audio_bus_layout_audit', params, args.projectPath);
      if (stderr && stderr.includes('Failed to')) {
        return this.createErrorResponse(`Failed to audit audio bus layout: ${stderr}`);
      }
      let parsed: any;
      try { parsed = JSON.parse(stdout.trim()); } catch { parsed = { raw: stdout.trim(), parse_error: 'JSON parse failed' }; }
      return { content: [{ type: 'text', text: JSON.stringify(parsed, null, 2) }] };
    } catch (error: any) {
      return this.createErrorResponse(`Failed to run audio bus layout audit: ${error?.message || 'Unknown error'}`);
    }
  }

  /**
   * Execute get Godot version (helper method)
   */
  private async executeGetGodotVersion(): Promise<{ stdout: string; stderr: string }> {
    // Ensure godotPath is set
    if (!this.godotPath) {
      await this.detectGodotPath();
      if (!this.godotPath) {
        throw new Error('Could not find a valid Godot executable path');
      }
    }

    const { stdout, stderr } = await execAsync(`"${this.godotPath}" --version`);
    return { stdout, stderr };
  }

  /**
   * Run the MCP server
   */
  async run() {
    try {
      // Detect Godot path before starting the server
      await this.detectGodotPath();

      if (!this.godotPath) {
        console.error('[SERVER] Failed to find a valid Godot executable path');
        console.error('[SERVER] Please set GODOT_PATH environment variable or provide a valid path');
        process.exit(1);
      }

      // Check if the path is valid
      const isValid = await this.isValidGodotPath(this.godotPath);

      if (!isValid) {
        if (this.strictPathValidation) {
          // In strict mode, exit if the path is invalid
          console.error(`[SERVER] Invalid Godot path: ${this.godotPath}`);
          console.error('[SERVER] Please set a valid GODOT_PATH environment variable or provide a valid path');
          process.exit(1);
        } else {
          // In compatibility mode, warn but continue with the default path
          console.warn(`[SERVER] Warning: Using potentially invalid Godot path: ${this.godotPath}`);
          console.warn('[SERVER] This may cause issues when executing Godot commands');
          console.warn('[SERVER] This fallback behavior will be removed in a future version. Set strictPathValidation: true to opt-in to the new behavior.');
        }
      }

      console.log(`[SERVER] Using Godot at: ${this.godotPath}`);

      const transport = new StdioServerTransport();
      await this.server.connect(transport);
      console.error('Godot MCP server running on stdio');
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('[SERVER] Failed to start:', errorMessage);
      process.exit(1);
    }
  }
}

// Create and run the server
const server = new GodotServer();
server.run().catch((error: unknown) => {
  const errorMessage = error instanceof Error ? error.message : 'Unknown error';
  console.error('Failed to run server:', errorMessage);
  process.exit(1);
});
