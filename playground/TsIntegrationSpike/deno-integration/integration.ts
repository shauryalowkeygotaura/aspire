import { existsSync } from 'node:fs';
import path from 'node:path';
import type {
    ContainerResource,
    DistributedApplicationBuilder,
    DockerfileBuilderCallbackContext,
    ExecutableResource,
} from '../.modules/aspire.js';
import {
    AspireExport,
    defineIntegration,
    type AspireTypeRef,
} from '../.modules/base.js';

const defaultDenoImage = 'denoland/deno:alpine-2.5.6';
const defaultPermissions = ['--allow-net', '--allow-env'];

const builderType: AspireTypeRef = {
    typeId: 'Aspire.Hosting/Aspire.Hosting.IDistributedApplicationBuilder',
    category: 'Handle',
    isInterface: true,
};

const executableType: AspireTypeRef = {
    typeId: 'Aspire.Hosting/Aspire.Hosting.ApplicationModel.ExecutableResource',
    category: 'Handle',
    isInterface: false,
};

const stringType: AspireTypeRef = {
    typeId: 'string',
    category: 'Primitive',
};

const numberType: AspireTypeRef = {
    typeId: 'number',
    category: 'Primitive',
};

const booleanType: AspireTypeRef = {
    typeId: 'boolean',
    category: 'Primitive',
};

const stringArrayType: AspireTypeRef = {
    typeId: 'array',
    category: 'Array',
    elementType: stringType,
};

interface AddDenoAppArgs
{
    builder: DistributedApplicationBuilder;
    name: string;
    appDirectory: string;
    scriptPath: string;
    args?: string[];
}

interface WithDenoArgsArgs
{
    resource: ExecutableResource;
    args: string[];
}

interface WithDenoPermissionsArgs
{
    resource: ExecutableResource;
    permissions: string[];
}

interface WithDenoTaskArgs
{
    resource: ExecutableResource;
    taskName: string;
    args?: string[];
}

interface WithDenoBuildTaskArgs
{
    resource: ExecutableResource;
    taskName: string;
    args?: string[];
}

interface WithDenoDockerfileBaseImageArgs
{
    resource: ExecutableResource;
    runtimeImage?: string;
    buildImage?: string;
}

interface PublishAsDenoDockerFileArgs
{
    resource: ExecutableResource;
    runtimeImage?: string;
    buildImage?: string;
    buildTask?: string;
    buildArgs?: string[];
    cache?: boolean;
    port?: number;
    dockerfilePath?: string;
    stage?: string;
    useExistingDockerfile?: boolean;
    user?: string;
}

interface DenoAppState
{
    appHostDirectory: string;
    appDirectory: string;
    scriptPath: string;
    args: string[];
    permissions: string[];
    runTask?: string;
    runTaskArgs: string[];
    buildTask?: string;
    buildTaskArgs: string[];
    runtimeImage: string;
    buildImage: string;
}

const stateByResource = new Map<string, DenoAppState>();

export const addDenoApp = AspireExport<AddDenoAppArgs, ExecutableResource>(
    {
        id: 'spike.deno/addDenoApp',
        method: 'addDenoApp',
        description: 'Adds a Deno application as an executable resource',
        projection: {
            capabilityKind: 'Method',
            targetTypeId: builderType.typeId,
            targetType: builderType,
            targetParameterName: 'builder',
            returnsBuilder: true,
            returnType: executableType,
            parameters: [
                { name: 'name', type: stringType },
                { name: 'appDirectory', type: stringType },
                { name: 'scriptPath', type: stringType },
                { name: 'args', type: stringArrayType, isOptional: true },
            ],
        },
    },
    async ({ builder, name, appDirectory, scriptPath, args = [] }) => {
        console.log(`[@spike/aspire-deno] addDenoApp('${name}') starting`);

        const appHostDirectory = await builder.appHostDirectory();
        const fullAppDirectory = path.resolve(appHostDirectory, appDirectory);
        if (!existsSync(fullAppDirectory)) {
            throw new Error(`Deno app directory '${appDirectory}' does not exist under '${appHostDirectory}'.`);
        }

        const state: DenoAppState = {
            appHostDirectory,
            appDirectory,
            scriptPath,
            args,
            permissions: [...defaultPermissions],
            runTaskArgs: [],
            buildTaskArgs: [],
            runtimeImage: defaultDenoImage,
            buildImage: defaultDenoImage,
        };

        const deno = await builder.addExecutable(name, 'deno', appDirectory, getRunArgs(state));
        await deno.withRequiredCommand('deno', { helpLink: 'https://docs.deno.com/runtime/getting_started/installation/' });
        await deno.withOtlpExporter();
        await deno.withIconName('CodeJsRectangle');
        await deno.withEnvironment('DENO_ENV', 'development');

        setState(deno, state);

        console.log(`[@spike/aspire-deno] addDenoApp('${name}') complete`);
        return deno;
    }
);

export const withDenoArgs = AspireExport<WithDenoArgsArgs, ExecutableResource>(
    {
        id: 'spike.deno/withDenoArgs',
        method: 'withDenoArgs',
        description: 'Replaces the command-line arguments passed to the Deno script',
        projection: {
            capabilityKind: 'Method',
            targetTypeId: executableType.typeId,
            targetType: executableType,
            targetParameterName: 'resource',
            returnsBuilder: true,
            returnType: executableType,
            parameters: [
                { name: 'args', type: stringArrayType },
            ],
        },
    },
    async ({ resource, args }) => {
        const state = getState(resource);
        state.args = args;
        await updateRunCommand(resource, state);

        return resource;
    }
);

export const withDenoPermissions = AspireExport<WithDenoPermissionsArgs, ExecutableResource>(
    {
        id: 'spike.deno/withDenoPermissions',
        method: 'withDenoPermissions',
        description: 'Configures the Deno permissions used for direct deno run execution',
        projection: {
            capabilityKind: 'Method',
            targetTypeId: executableType.typeId,
            targetType: executableType,
            targetParameterName: 'resource',
            returnsBuilder: true,
            returnType: executableType,
            parameters: [
                { name: 'permissions', type: stringArrayType },
            ],
        },
    },
    async ({ resource, permissions }) => {
        const state = getState(resource);
        state.permissions = permissions.map(normalizePermission);
        await updateRunCommand(resource, state);

        return resource;
    }
);

export const withDenoTask = AspireExport<WithDenoTaskArgs, ExecutableResource>(
    {
        id: 'spike.deno/withDenoTask',
        method: 'withDenoTask',
        description: 'Runs a Deno application by invoking a task from deno.json',
        projection: {
            capabilityKind: 'Method',
            targetTypeId: executableType.typeId,
            targetType: executableType,
            targetParameterName: 'resource',
            returnsBuilder: true,
            returnType: executableType,
            parameters: [
                { name: 'taskName', type: stringType },
                { name: 'args', type: stringArrayType, isOptional: true },
            ],
        },
    },
    async ({ resource, taskName, args = [] }) => {
        const state = getState(resource);
        state.runTask = taskName;
        state.runTaskArgs = args;
        await updateRunCommand(resource, state);

        return resource;
    }
);

export const withDenoBuildTask = AspireExport<WithDenoBuildTaskArgs, ExecutableResource>(
    {
        id: 'spike.deno/withDenoBuildTask',
        method: 'withDenoBuildTask',
        description: 'Configures a deno task to run while generating the deployment Dockerfile',
        projection: {
            capabilityKind: 'Method',
            targetTypeId: executableType.typeId,
            targetType: executableType,
            targetParameterName: 'resource',
            returnsBuilder: true,
            returnType: executableType,
            parameters: [
                { name: 'taskName', type: stringType },
                { name: 'args', type: stringArrayType, isOptional: true },
            ],
        },
    },
    async ({ resource, taskName, args = [] }) => {
        const state = getState(resource);
        state.buildTask = taskName;
        state.buildTaskArgs = args;

        return resource;
    }
);

export const withDenoDockerfileBaseImage = AspireExport<WithDenoDockerfileBaseImageArgs, ExecutableResource>(
    {
        id: 'spike.deno/withDenoDockerfileBaseImage',
        method: 'withDenoDockerfileBaseImage',
        description: 'Configures the Deno Docker images used for generated deployment Dockerfiles',
        projection: {
            capabilityKind: 'Method',
            targetTypeId: executableType.typeId,
            targetType: executableType,
            targetParameterName: 'resource',
            returnsBuilder: true,
            returnType: executableType,
            parameters: [
                { name: 'runtimeImage', type: stringType, isOptional: true },
                { name: 'buildImage', type: stringType, isOptional: true },
            ],
        },
    },
    async ({ resource, runtimeImage, buildImage }) => {
        const state = getState(resource);
        state.runtimeImage = runtimeImage ?? state.runtimeImage;
        state.buildImage = buildImage ?? runtimeImage ?? state.buildImage;

        return resource;
    }
);

export const publishAsDenoDockerFile = AspireExport<PublishAsDenoDockerFileArgs, ExecutableResource>(
    {
        id: 'spike.deno/publishAsDenoDockerFile',
        method: 'publishAsDenoDockerFile',
        description: 'Publishes a Deno application as a Dockerfile-backed container resource',
        projection: {
            capabilityKind: 'Method',
            targetTypeId: executableType.typeId,
            targetType: executableType,
            targetParameterName: 'resource',
            returnsBuilder: true,
            returnType: executableType,
            parameters: [
                { name: 'runtimeImage', type: stringType, isOptional: true },
                { name: 'buildImage', type: stringType, isOptional: true },
                { name: 'buildTask', type: stringType, isOptional: true },
                { name: 'buildArgs', type: stringArrayType, isOptional: true },
                { name: 'cache', type: booleanType, isOptional: true },
                { name: 'port', type: numberType, isOptional: true },
                { name: 'dockerfilePath', type: stringType, isOptional: true },
                { name: 'stage', type: stringType, isOptional: true },
                { name: 'useExistingDockerfile', type: booleanType, isOptional: true },
                { name: 'user', type: stringType, isOptional: true },
            ],
        },
    },
    async ({ resource, ...options }) => {
        const state = getState(resource);
        const fullAppDirectory = path.resolve(state.appHostDirectory, state.appDirectory);
        const dockerfilePath = options.dockerfilePath ?? 'Dockerfile';
        const existingDockerfilePath = path.resolve(fullAppDirectory, dockerfilePath);
        const useExistingDockerfile = options.useExistingDockerfile ?? existsSync(existingDockerfilePath);

        await resource.publishAsDockerFile(async (container: ContainerResource) => {
            await container.withEnvironment('DENO_ENV', 'production');

            if (useExistingDockerfile) {
                await container.withDockerfile(state.appDirectory, {
                    dockerfilePath,
                    stage: options.stage,
                });
                return;
            }

            await container.withDockerfileBuilder(
                state.appDirectory,
                async context => configureGeneratedDockerfile(context, state, options),
                { stage: options.stage ?? 'runtime' });
        });

        return resource;
    }
);

async function configureGeneratedDockerfile(
    context: DockerfileBuilderCallbackContext,
    state: DenoAppState,
    options: Omit<PublishAsDenoDockerFileArgs, 'resource'>): Promise<void>
{
    const dockerfile = await context.builder();
    const container = await context.resource();
    const buildImage = options.buildImage ?? state.buildImage;
    const runtimeImage = options.runtimeImage ?? state.runtimeImage;
    const buildTask = options.buildTask ?? state.buildTask;
    const buildArgs = options.buildArgs ?? state.buildTaskArgs;

    await dockerfile.addContainerFilesStages(container);

    const build = await dockerfile.from(buildImage, { stageName: 'build' });
    await build
        .workDir('/app')
        .copy('.', '.', { chown: 'deno:deno' });

    if (options.cache ?? true) {
        await build.run(shellJoin(['deno', 'cache', ...state.permissions, state.scriptPath]));
    }

    if (buildTask) {
        await build.run(shellJoin(['deno', 'task', buildTask, ...buildArgs]));
    }

    const runtime = await dockerfile.from(runtimeImage, { stageName: 'runtime' });
    await runtime
        .workDir('/app')
        .copyFrom('build', '/app', '/app', { chown: 'deno:deno' })
        .env('DENO_ENV', 'production');

    if (options.port !== undefined) {
        await runtime.expose(options.port);
    }

    await runtime
        .user(options.user ?? 'deno')
        .entrypoint(['deno', ...getRunArgs(state)])
        .addContainerFiles(container, '/app');
}

async function updateRunCommand(resource: ExecutableResource, state: DenoAppState): Promise<void>
{
    await resource.withArgsReplace(getRunArgs(state));
}

function getRunArgs(state: DenoAppState): string[]
{
    if (state.runTask) {
        return ['task', state.runTask, ...state.runTaskArgs];
    }

    return ['run', ...state.permissions, state.scriptPath, ...state.args];
}

function setState(resource: ExecutableResource, state: DenoAppState): void
{
    stateByResource.set(resourceKey(resource), state);
}

function getState(resource: ExecutableResource): DenoAppState
{
    const state = stateByResource.get(resourceKey(resource));
    if (!state) {
        throw new Error('This resource was not created by addDenoApp.');
    }

    return state;
}

function resourceKey(resource: ExecutableResource): string
{
    const handle = resource.toJSON();
    return `${handle.$type}:${handle.$handle}`;
}

function normalizePermission(permission: string): string
{
    const value = permission.trim();
    if (value.length === 0) {
        throw new Error('Deno permission values cannot be empty.');
    }

    if (value.startsWith('--')) {
        return value;
    }

    return value.startsWith('allow-') ? `--${value}` : `--allow-${value}`;
}

function shellJoin(args: readonly string[]): string
{
    return args.map(quotePosixShellArg).join(' ');
}

function quotePosixShellArg(value: string): string
{
    if (/^[A-Za-z0-9_./:=@+-]+$/.test(value)) {
        return value;
    }

    // Dockerfile RUN commands execute under the image's POSIX shell. Single-quote
    // each argument and escape embedded single quotes to avoid script/task names or
    // paths being interpreted as shell syntax.
    return `'${value.replaceAll("'", "'\\''")}'`;
}

export default defineIntegration({
    name: 'DenoIntegration',
    capabilities: [
        addDenoApp,
        withDenoArgs,
        withDenoPermissions,
        withDenoTask,
        withDenoBuildTask,
        withDenoDockerfileBaseImage,
        publishAsDenoDockerFile,
    ],
});
