
pipeline {
    agent {
        node {
            label 'Roboshop'
        }
    }

    environment {
        APP_VERSION = ''
        IMAGE_NAME = ''

        AWS_ACCOUNT_ID = '104050870679'
        AWS_REGION = 'us-east-1'
        ECR_REPO_NAME = 'roboshop/catalogue'
        ECR_REGISTRY = '104050870679.dkr.ecr.us-east-1.amazonaws.com'
    }

    options {
        timeout(time: 90, unit: 'MINUTES')
        timestamps()
    }

    stages {

        stage('Read Version') {
            steps {
                script {
                    def version = sh(
                        script: "node -p \"require('./package.json').version || ''\"",
                        returnStdout: true
                    ).trim()

                    if (!version || version == 'undefined' || version == 'null') {
                        error 'Unable to read version from package.json'
                    }

                    env.APP_VERSION = version

                    echo "Application Version: ${version}"
                    echo "ECR Registry: ${env.ECR_REGISTRY}"
                    echo "ECR Repository: ${env.ECR_REPO_NAME}"
                }
            }
        }

        stage('Install Dependencies') {
            steps {
                sh 'npm install'
            }
        }

        stage('Unit Tests') {
            steps {
                sh 'npm test'
            }
        }

        stage('SonarQube Analysis') {
            steps {
                script {
                    def scannerHome = tool name: 'sonar-8'

                    withSonarQubeEnv('sonar-server') {
                        sh """
                            ${scannerHome}/bin/sonar-scanner \
                            '-Dsonar.exclusions=**/node_modules/**,**/coverage/**,**/trivy-report.html,**/trivy-os-report.html,**/trivy-reports/**,**/reports/**'
                        """
                    }
                }
            }
        }

        stage('Quality Gate') {
            steps {
                timeout(time: 1, unit: 'HOURS') {
                    waitForQualityGate abortPipeline: true
                }
            }
        }

        stage('Dependabot Alerts Check') {
            steps {
                withCredentials([
                    string(
                        credentialsId: 'github-token',
                        variable: 'GITHUB_TOKEN'
                    )
                ]) {
                    script {
                        def owner = 'ramireddy251'
                        def repo = 'catalogue-unit-tests'

                        def response = sh(
                            script: """
                                curl -s -w "\\n%{http_code}" \
                                -H "Authorization: Bearer \$GITHUB_TOKEN" \
                                -H "Accept: application/vnd.github+json" \
                                -H "X-GitHub-Api-Version: 2022-11-28" \
                                "https://api.github.com/repos/${owner}/${repo}/dependabot/alerts?severity=high,critical&state=open&per_page=100"
                            """,
                            returnStdout: true
                        ).trim()

                        def parts = response.tokenize('\n')
                        def httpStatus = parts[-1].trim()
                        def body = parts.size() > 1 ?
                            parts[0..-2].join('\n') : ''

                        if (httpStatus != '200') {
                            error "GitHub API failed with HTTP ${httpStatus}. Check token permissions. Response: ${body}"
                        }

                        def alerts = readJSON text: body

                        if (alerts.size() == 0) {
                            echo 'No HIGH or CRITICAL Dependabot alerts found.'
                        } else {
                            echo "Found ${alerts.size()} HIGH/CRITICAL Dependabot alert(s):"

                            alerts.each { alert ->
                                def pkg = alert.security_vulnerability?.package?.name ?: 'unknown'
                                def severity = alert.security_advisory?.severity?.toUpperCase() ?: 'UNKNOWN'
                                def summary = alert.security_advisory?.summary ?: 'No summary'
                                def fixedIn = alert.security_vulnerability?.first_patched_version?.identifier ?: 'No fix available'

                                echo "[${severity}] ${pkg} - ${summary} (Fixed in: ${fixedIn})"
                            }

                            error "Pipeline failed: ${alerts.size()} HIGH/CRITICAL Dependabot alert(s) detected."
                        }
                    }
                }
            }
        }

        stage('Build Docker Image') {
            steps {
                script {
                    // Read version again to avoid relying on a previous stage's variable
                    def version = sh(
                        script: "node -p \"require('./package.json').version || ''\"",
                        returnStdout: true
                    ).trim()

                    if (!version || version == 'undefined' || version == 'null') {
                        error 'APP_VERSION is empty. Cannot build Docker image.'
                    }

                    def imageName = "${env.ECR_REGISTRY}/${env.ECR_REPO_NAME}:${version}"

                    env.APP_VERSION = version
                    env.IMAGE_NAME = imageName

                    echo "Application Version: ${version}"
                    echo "Building Docker Image: ${imageName}"

                    sh """
                        docker build --no-cache -t '${imageName}' .
                    """

                    echo "Docker image built successfully: ${imageName}"
                }
            }
        }

        stage('Trivy OS Scan') {
            steps {
                script {
                    // Reconstruct and validate image name
                    def version = env.APP_VERSION?.trim()

                    if (!version) {
                        version = sh(
                            script: "node -p \"require('./package.json').version || ''\"",
                            returnStdout: true
                        ).trim()
                    }

                    if (!version || version == 'undefined' || version == 'null') {
                        error 'Cannot run Trivy: application version is missing.'
                    }

                    def imageName = "${env.ECR_REGISTRY}/${env.ECR_REPO_NAME}:${version}"

                    env.APP_VERSION = version
                    env.IMAGE_NAME = imageName

                    echo "Scanning Docker Image: ${imageName}"

                    sh '''
                        curl -sfL \
                        https://raw.githubusercontent.com/aquasecurity/trivy/main/contrib/html.tpl \
                        -o html.tpl

                        test -s html.tpl
                    '''

                    // Generate text report
                    sh """
                        trivy image \
                            --scanners vuln \
                            --pkg-types os \
                            --severity HIGH,MEDIUM \
                            --format table \
                            --output trivy-os-report.txt \
                            --exit-code 0 \
                            '${imageName}'
                    """

                    // Generate HTML report
                    sh """
                        trivy image \
                            --scanners vuln \
                            --pkg-types os \
                            --severity HIGH,MEDIUM \
                            --format template \
                            --template "@html.tpl" \
                            --output trivy-os-report.html \
                            --exit-code 0 \
                            '${imageName}'
                    """

                    sh 'cat trivy-os-report.txt'

                    // Publish HTML report
                    publishHTML(target: [
                        allowMissing: false,
                        alwaysLinkToLastBuild: true,
                        keepAll: true,
                        reportDir: '.',
                        reportFiles: 'trivy-os-report.html',
                        reportName: 'Trivy OS Vulnerability Report'
                    ])

                    // Fail pipeline if HIGH or MEDIUM vulnerabilities exist
                    def scanResult = sh(
                        script: """
                            trivy image \
                                --scanners vuln \
                                --pkg-types os \
                                --severity HIGH,MEDIUM \
                                --exit-code 1 \
                                --quiet \
                                '${imageName}'
                        """,
                        returnStatus: true
                    )

                    if (scanResult != 0) {
                        error 'Trivy found HIGH/MEDIUM OS vulnerabilities. Check the Trivy OS Vulnerability Report.'
                    } else {
                        echo 'No HIGH or MEDIUM OS vulnerabilities found.'
                    }
                }
            }
        }

        stage('Push to ECR') {
            steps {
                script {
                    // Reconstruct and validate image name
                    def version = env.APP_VERSION?.trim()

                    if (!version) {
                        version = sh(
                            script: "node -p \"require('./package.json').version || ''\"",
                            returnStdout: true
                        ).trim()
                    }

                    if (!version || version == 'undefined' || version == 'null') {
                        error 'Cannot push image: application version is missing.'
                    }

                    def imageName = "${env.ECR_REGISTRY}/${env.ECR_REPO_NAME}:${version}"

                    echo "Pushing Docker Image: ${imageName}"

                    sh """
                        aws ecr get-login-password --region '${env.AWS_REGION}' |
                        docker login \
                            --username AWS \
                            --password-stdin '${env.ECR_REGISTRY}'

                        docker push '${imageName}'
                    """

                    echo "Image pushed successfully: ${imageName}"
                }
            }
        }
    }

    post {
        always {
            echo 'Pipeline execution completed.'
        }

        success {
            echo 'Pipeline SUCCESS.'
        }

        failure {
            echo 'Pipeline FAILURE. Check the failed stage logs.'
        }
    }
}
