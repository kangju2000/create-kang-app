#!/usr/bin/env node
import { execa } from 'execa';
import Listr from 'listr';
import meow from 'meow';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { select, confirm } from '@inquirer/prompts';
import cpy from 'cpy';
import replaceString from 'replace-string';
import makeDir from 'make-dir';
import slugify from 'slugify';

const cli = meow(
  ` 
  Usage
    $ create-kang-app <project-directory>

    디렉토리를 지정하지 않으면 현재 디렉토리에 생성됩니다.

  Options
    --template  Template to use. (next-ts, vite-ts, node-ts, node-js)

    템플릿을 선택하지 않으면 선택할 수 있는 목록이 나타납니다.

  Examples
    $ create-kang-app my-app
    $ create-kang-app my-app --template next-ts
  `,
  {
    importMeta: import.meta,
    flags: {
      template: {
        type: 'string',
        default: '',
      },
    },
  }
);

const readProjectTemplate = async () => {
  const projectChoices = [
    { type: 'separator', separator: '---- 프로젝트 목록 ----' },
    { description: 'Next.js + TypeScript', value: 'next-ts' },
    { description: 'React + TypeScript + Vite', value: 'vite-ts' },
    // { description: 'Node.js + TypeScript', value: 'node-ts' },
    // { description: 'Node.js  + JavaScript', value: 'node-js' },
  ];

  const projectTemplate = await select({
    message: '템플릿을 선택하세요.',
    loop: false,
    pageSize: 10,
    choices: projectChoices,
  });

  return projectTemplate;
};

const readPackageManager = async () => {
  const packageManager = await select({
    message: '패키지 매니저를 선택하세요.',
    loop: false,
    pageSize: 3,
    choices: [{ value: 'npm' }, { value: 'yarn' }, { value: 'pnpm' }],
  });

  return packageManager;
};

const readConfirmLint = async () => {
  const confirmLint = await confirm({
    message: '린트 설정(ESLint, Prettier)을 추가하시겠습니까? (default: true)',
    default: true,
  });

  return confirmLint;
};

const printDevCommand = (projectTemplate, pkgManager) => {
  switch (projectTemplate) {
    case 'next-ts':
    case 'vite-ts':
      return pkgManager === 'npm' ? 'npm run dev' : `${pkgManager} run dev`;
    default:
      return '';
  }
};

const copyWithTemplate = async (from, to, variables) => {
  const dirname = path.dirname(to);
  await makeDir(dirname);

  const source = await fs.readFile(from, 'utf8');
  const generatedSource = source.replace(/%(\w+)%/g, (_, key) => variables[key.toLowerCase()]);

  await fs.writeFile(to, generatedSource);
};

const execaInProject = async (command, args, options) => {
  return execa(command, args, { ...options, cwd: projectDirectoryPath });
};

const projectDirectoryPath = path.resolve(process.cwd(), cli.input[0] || '.');
const __dirname = path.dirname(fileURLToPath(import.meta.url));

(async () => {
  const projectTemplate = cli.flags.template || (await readProjectTemplate());
  const packageManager = await readPackageManager();
  const confirmLint = await readConfirmLint();

  const pkgName = slugify(path.basename(projectDirectoryPath));
  const templateConfigsPath = path.resolve(__dirname, 'templates/configs');
  const templateProjectPath = path.resolve(__dirname, `templates/projects/${projectTemplate}`);
  const relativePath = path.relative(process.cwd(), projectDirectoryPath);

  const fromPath = (file, rootPath) => path.join(path.resolve(__dirname, rootPath || templateProjectPath), file);
  const toPath = (file, rootPath) => path.join(rootPath, file);

  const tasks = new Listr(
    [
      {
        title: '템플릿을 복사합니다.',
        async task(_, task) {
          try {
            const variables = { name: pkgName, description: `${pkgName} 프로젝트입니다.` };
            const files = await fs.readdir(templateProjectPath, { recursive: true });
            const filteredFiles = files.filter((file) => file.includes('_'));

            await cpy([fromPath('**/*'), ...filteredFiles.map((file) => `!${fromPath(file)}`)], projectDirectoryPath);
            await Promise.all(
              filteredFiles.map((file) => {
                const fileName = replaceString(file.split('/').pop(), '_', '');
                const relativeFilePath = file.split('/').slice(0, -1).join('/');

                copyWithTemplate(
                  fromPath(file),
                  toPath(fileName, [projectDirectoryPath, relativeFilePath].join('/')),
                  variables
                );
              })
            );
          } catch (err) {
            task.report(err);
          }
        },
      },
      {
        title: `${packageManager}을 통해 디펜던시들을 설치합니다.`,
        async task(ctx, task) {
          await execaInProject(packageManager, ['install'])
            .then(() => {
              ctx[packageManager] = true;
            })
            .catch(async () => {
              ctx[packageManager] = false;
              task.skip('설치를 건너뜁니다.');
            });
        },
      },
      {
        title: '린트 설정을 추가합니다.',
        enabled: () => confirmLint,
        async task() {
          const lintFiles = ['.eslintrc.js', '.prettierrc'];
          await execaInProject(packageManager, [
            packageManager === 'npm' ? 'install' : 'add',
            '-D',
            'eslint',
            'prettier',
            'eslint-config-prettier',
            'eslint-plugin-prettier',
            'eslint-plugin-import',
            '@typescript-eslint/eslint-plugin',
            '@typescript-eslint/parser',
          ]);
          await cpy(
            lintFiles.map((file) => fromPath(file, templateConfigsPath)),
            projectDirectoryPath
          );

          if (projectTemplate === 'vite-ts') {
            await fs.rename(`${projectDirectoryPath}/.eslintrc.js`, `${projectDirectoryPath}/.eslintrc.cjs`);
          }
        },
      },
      {
        title: '린트를 통해 코드를 정리합니다.',
        enabled: () => confirmLint,
        async task() {
          await execaInProject(`${projectDirectoryPath}/node_modules/.bin/eslint`, ['--fix', '.']);
          await execaInProject(`${projectDirectoryPath}/node_modules/.bin/prettier`, ['--write', '.']);
        },
      },
    ],
    { renderer: 'slient' }
  );

  return tasks
    .run()
    .then((ctx) => {
      const pkgManager = Object.keys(ctx).find((key) => ctx[key] === true);
      const devCommand = printDevCommand(projectTemplate, pkgManager);

      console.log(
        [
          '',
          '🎉 프로젝트가 성공적으로 생성되었습니다.',
          '',
          '프로젝트를 실행하려면 아래 명령어를 입력하세요.',
          '',
          relativePath === '' ? `  ${devCommand}` : `  cd ${relativePath} && ${devCommand}`,
          '',
        ].join('\n')
      );
    })
    .catch((err) => {
      console.error(err);
    });
})();
