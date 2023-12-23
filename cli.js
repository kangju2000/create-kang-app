import { execa } from 'execa';
import Listr from 'listr';
import meow from 'meow'
import path from 'node:path'
import { fileURLToPath } from 'node:url';

const cli = meow(
  `
  Usage
    $ create-kang-app <project-directory>

  Options
    --template  Template to use (default: next-ts)

  Examples
    $ create-kang-app my-app
    $ create-kang-app my-app --template next-ts
  `,
  {
    importMeta: import.meta,
    flags: {
      template: {
        type: 'string',
        default: 'next-ts',
      },
    },
  }
)

const projectDirectoryPath = path.resolve(process.cwd(), cli.input[0] || '.');
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const templatePath = path.resolve(__dirname, `templates/${cli.flags.template}`);
const relativePath = path.relative(process.cwd(), projectDirectoryPath);

const tasks = new Listr([
  {
    title: '템플릿을 복사합니다.',
    task: () => execa('cp', ['-a', templatePath +'/.', projectDirectoryPath])
  },
  {
    title: 'dependencies를 설치합니다.',
    task: () => execa('npm', ['install'], { cwd: projectDirectoryPath })
  }
])

tasks.run().then(() => {
	console.log([
		'',
		'🎉 프로젝트가 성공적으로 생성되었습니다.',
		'',
		'프로젝트를 실행하려면 아래 명령어를 입력하세요.',
		'',
		`  ${relativePath}$ npm run dev`,
		''
	].join('\n'));
}).catch((err) => {
  console.error(err);
})
